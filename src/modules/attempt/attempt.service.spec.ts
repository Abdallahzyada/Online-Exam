import { describe, expect, it, jest } from '@jest/globals';
import { AttemptService } from './attempt.service.js';
import { AppError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import {
  makeHarness, multiQuestion, otherStudentId, publishedQuiz, q1, q2, quizId, singleQuestion, startTime, studentId, unknownId
} from './testing/fixtures.js';

const allCorrect = [
  { questionId: q1, selectedOptionIds: ['opt_a'] },
  { questionId: q2, selectedOptionIds: ['opt_c', 'opt_a'] }
];
const code = (error: unknown) => (error instanceof AppError ? `${error.statusCode} ${error.code}` : String(error));
async function rejection(promise: Promise<unknown>) {
  try { await promise; } catch (error: unknown) { return code(error); }
  throw new Error('Expected rejection');
}

async function started(harness = makeHarness()) {
  const service = new AttemptService(harness.dependencies);
  const attempt = await service.startAttempt(studentId, quizId);
  return { service, harness, attemptId: attempt.attemptId, attempt };
}

describe('AttemptService.startAttempt', () => {
  it('creates an IN_PROGRESS attempt with a server timer and a full snapshot', async () => {
    const { harness, attempt } = await started();
    expect(attempt).toMatchObject({
      quizTitle: 'Node Basics', durationMinutes: 15,
      startedAt: startTime.toISOString(), expiresAt: new Date(startTime.getTime() + 15 * 60_000).toISOString()
    });
    const stored = harness.repository.records.get(attempt.attemptId);
    expect(stored).toMatchObject({ status: 'IN_PROGRESS', studentId, quizId, questionsCount: 2, totalPoints: 2 });
    expect(stored?.questions[0]?.correctOptionIds).toEqual(['opt_a']);
  });

  it('never returns answer keys or correctness while in progress (BR-10)', async () => {
    const { attempt } = await started();
    const body = JSON.stringify(attempt);
    expect(body).not.toContain('correctOptionIds');
    expect(body).not.toContain('isCorrect');
    expect(attempt.questions[0]).toEqual({
      questionId: q1, text: 'Pick A', type: 'single', points: 1,
      options: [{ optionId: 'opt_a', text: 'A' }, { optionId: 'opt_b', text: 'B' }]
    });
  });

  it('keeps grading on the snapshot after the source question changes (BR-09)', async () => {
    const harness = makeHarness();
    const { service, attemptId } = await started(harness);
    jest.mocked(harness.dependencies.questions.listQuestions).mockResolvedValue([{ ...singleQuestion(), correctOptionIds: ['opt_b'] }]);
    const result = await service.submitAttempt(studentId, attemptId, allCorrect);
    expect(result.correctCount).toBe(2);
  });

  it.each([
    ['a missing quiz', null],
    ['an unpublished quiz', { ...publishedQuiz, isPublished: false }]
  ])('hides %s with 404', async (_label, quiz) => {
    const service = new AttemptService(makeHarness(undefined, quiz).dependencies);
    expect(await rejection(service.startAttempt(studentId, quizId))).toBe('404 NOT_FOUND');
  });

  it.each([
    ['no questions', [], publishedQuiz],
    ['a zero duration', [singleQuestion()], { ...publishedQuiz, durationMinutes: 0 }],
    ['too many questions', Array.from({ length: 1001 }, () => singleQuestion()), publishedQuiz]
  ])('blocks a quiz with %s (BR-07)', async (_label, questions, quiz) => {
    const harness = makeHarness(questions, quiz);
    expect(await rejection(new AttemptService(harness.dependencies).startAttempt(studentId, quizId))).toBe('409 CONFLICT');
    expect(harness.repository.records.size).toBe(0);
  });
});

describe('AttemptService.submitAttempt', () => {
  it('grades, stores and returns the score summary', async () => {
    const { service, harness, attemptId } = await started();
    harness.advance(125_000);
    const result = await service.submitAttempt(studentId, attemptId, allCorrect);
    expect(result).toEqual({
      attemptId, scorePercentage: 100, correctCount: 2, incorrectCount: 0,
      earnedPoints: 2, totalPoints: 2, passed: true, timeSpentSeconds: 125
    });
    expect(harness.repository.records.get(attemptId)).toMatchObject({
      status: 'SUBMITTED', submittedAt: harness.clock.now, scorePercentage: 100,
      questionResults: [{ questionId: q1, isCorrect: true }, { questionId: q2, isCorrect: true }]
    });
  });

  it('records unanswered questions as incorrect for Dashboard analytics', async () => {
    const { service, harness, attemptId } = await started();
    const result = await service.submitAttempt(studentId, attemptId, [{ questionId: q1, selectedOptionIds: ['opt_a'] }]);
    expect(result).toMatchObject({ scorePercentage: 50, correctCount: 1, incorrectCount: 1, passed: true });
    expect(harness.repository.records.get(attemptId)?.questionResults).toEqual([
      { questionId: q1, isCorrect: true }, { questionId: q2, isCorrect: false }
    ]);
  });

  it('accepts a submission inside the 10-second grace window and clamps time (15m07s)', async () => {
    const { service, harness, attemptId } = await started();
    harness.advance(15 * 60_000 + 7_000);
    expect(await service.submitAttempt(studentId, attemptId, allCorrect)).toMatchObject({ timeSpentSeconds: 900, passed: true });
  });

  it('rejects a submission past the grace window and stores EXPIRED with zero score (15m15s)', async () => {
    const { service, harness, attemptId } = await started();
    harness.advance(15 * 60_000 + 15_000);
    expect(await rejection(service.submitAttempt(studentId, attemptId, allCorrect))).toBe('400 ATTEMPT_EXPIRED');
    expect(harness.repository.records.get(attemptId)).toMatchObject({
      status: 'EXPIRED', scorePercentage: 0, passed: false, correctCount: 0, incorrectCount: 2, timeSpentSeconds: 900, answers: []
    });
  });

  it('does not let a zero passing score pass an expired attempt', async () => {
    const harness = makeHarness(undefined, { ...publishedQuiz, passingScorePercentage: 0 });
    const { service, attemptId } = await started(harness);
    harness.advance(16 * 60_000);
    await rejection(service.submitAttempt(studentId, attemptId, []));
    expect(harness.repository.records.get(attemptId)?.passed).toBe(false);
  });

  it('returns 409 for a second submission and never re-scores (BR-12)', async () => {
    const { service, harness, attemptId } = await started();
    await service.submitAttempt(studentId, attemptId, allCorrect);
    expect(await rejection(service.submitAttempt(studentId, attemptId, []))).toBe('409 ATTEMPT_ALREADY_SUBMITTED');
    expect(harness.repository.records.get(attemptId)?.scorePercentage).toBe(100);
  });

  it('lets exactly one of two parallel submissions win', async () => {
    const { service, harness, attemptId } = await started();
    const results = await Promise.allSettled([
      service.submitAttempt(studentId, attemptId, allCorrect), service.submitAttempt(studentId, attemptId, [])
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(result => result.status === 'rejected');
    expect(failure && failure.status === 'rejected' && code(failure.reason)).toBe('409 ATTEMPT_ALREADY_SUBMITTED');
    expect(harness.repository.records.get(attemptId)?.status).toBe('SUBMITTED');
  });

  it('reports ATTEMPT_EXPIRED when resubmitting an expired attempt', async () => {
    const { service, harness, attemptId } = await started();
    harness.advance(20 * 60_000);
    await rejection(service.submitAttempt(studentId, attemptId, []));
    expect(await rejection(service.submitAttempt(studentId, attemptId, []))).toBe('400 ATTEMPT_EXPIRED');
  });

  it('hides another student\'s attempt with 404 (BR-05)', async () => {
    const { service, harness, attemptId } = await started();
    expect(await rejection(service.submitAttempt(otherStudentId, attemptId, allCorrect))).toBe('404 NOT_FOUND');
    expect(harness.repository.records.get(attemptId)?.status).toBe('IN_PROGRESS');
  });

  it.each([
    ['an unknown question', [{ questionId: unknownId, selectedOptionIds: ['opt_a'] }], 'answers.0.questionId'],
    ['a repeated question', [{ questionId: q1, selectedOptionIds: ['opt_a'] }, { questionId: q1, selectedOptionIds: [] }], 'answers.1.questionId'],
    ['an unknown option', [{ questionId: q2, selectedOptionIds: ['opt_a', 'opt_z'] }], 'answers.0.selectedOptionIds.1']
  ])('rejects %s with 400 before claiming the attempt', async (_label, answers, path) => {
    const { service, harness, attemptId } = await started();
    const error = await service.submitAttempt(studentId, attemptId, answers).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).details).toEqual([{ path, code: 'custom' }]);
    expect(harness.repository.records.get(attemptId)?.status).toBe('IN_PROGRESS');
  });

  it('releases the claim when storing the result fails, so the student can retry', async () => {
    const { service, harness, attemptId } = await started();
    jest.spyOn(harness.repository, 'finalize').mockRejectedValueOnce(new Error('database down'));
    await expect(service.submitAttempt(studentId, attemptId, allCorrect)).rejects.toThrow('database down');
    expect(harness.repository.records.get(attemptId)?.status).toBe('IN_PROGRESS');
    expect((await service.submitAttempt(studentId, attemptId, allCorrect)).scorePercentage).toBe(100);
  });

  it('returns 409 if the claim is lost before finalizing', async () => {
    const { service, harness, attemptId } = await started();
    jest.spyOn(harness.repository, 'finalize').mockResolvedValueOnce(false);
    expect(await rejection(service.submitAttempt(studentId, attemptId, allCorrect))).toBe('409 ATTEMPT_ALREADY_SUBMITTED');
  });

  it('returns 404 if the attempt disappears between the read and the claim', async () => {
    const { service, harness, attemptId } = await started();
    jest.spyOn(harness.repository, 'claimForSubmission').mockImplementationOnce(async () => {
      harness.repository.records.delete(attemptId);
      return false;
    });
    await expect(service.submitAttempt(studentId, attemptId, allCorrect)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns 409 when another request holds the claim', async () => {
    const { service, harness, attemptId } = await started();
    jest.spyOn(harness.repository, 'claimForSubmission').mockResolvedValueOnce(false);
    expect(await rejection(service.submitAttempt(studentId, attemptId, allCorrect))).toBe('409 ATTEMPT_ALREADY_SUBMITTED');
  });
});

describe('AttemptService.reviewAttempt', () => {
  it('blocks review while the attempt is in progress (BR-10)', async () => {
    const { service, attemptId } = await started();
    expect(await rejection(service.reviewAttempt(studentId, attemptId))).toBe('403 ATTEMPT_NOT_SUBMITTED');
  });

  it('returns the answer diff after submission', async () => {
    const { service, harness, attemptId } = await started();
    harness.advance(60_000);
    await service.submitAttempt(studentId, attemptId, [{ questionId: q1, selectedOptionIds: ['opt_b'] }, { questionId: q2, selectedOptionIds: ['opt_a', 'opt_c', 'opt_c'] }]);
    const review = await service.reviewAttempt(studentId, attemptId);
    expect(review).toMatchObject({
      attemptId, quizId, quizTitle: 'Node Basics', status: 'SUBMITTED', submittedAt: harness.clock.now.toISOString(),
      scorePercentage: 50, correctCount: 1, incorrectCount: 1, earnedPoints: 1, totalPoints: 2, passed: true, timeSpentSeconds: 60
    });
    expect(review.questions).toEqual([
      { questionId: q1, text: 'Pick A', type: 'single', options: singleQuestion().options,
        selectedOptionIds: ['opt_b'], correctOptionIds: ['opt_a'], isCorrect: false, pointsEarned: 0, maxPoints: 1 },
      { questionId: q2, text: 'Pick A and C', type: 'multi', options: multiQuestion().options,
        selectedOptionIds: ['opt_a', 'opt_c'], correctOptionIds: ['opt_a', 'opt_c'], isCorrect: true, pointsEarned: 1, maxPoints: 1 }
    ]);
  });

  it('expires an abandoned attempt on review and shows it as all incorrect', async () => {
    const { service, harness, attemptId } = await started();
    harness.advance(30 * 60_000);
    const review = await service.reviewAttempt(studentId, attemptId);
    expect(review).toMatchObject({ status: 'EXPIRED', scorePercentage: 0, passed: false, correctCount: 0, incorrectCount: 2 });
    expect(review.questions.every(question => !question.isCorrect && question.selectedOptionIds.length === 0)).toBe(true);
  });

  it('hides another student\'s attempt with 404', async () => {
    const { service, attemptId } = await started();
    expect(await rejection(service.reviewAttempt(otherStudentId, attemptId))).toBe('404 NOT_FOUND');
  });

  it('returns 404 if an abandoned attempt disappears while expiring', async () => {
    const { service, harness, attemptId } = await started();
    harness.advance(30 * 60_000);
    jest.spyOn(harness.repository, 'expireOverdue').mockImplementationOnce(async () => {
      harness.repository.records.delete(attemptId);
      return 0;
    });
    expect(await rejection(service.reviewAttempt(studentId, attemptId))).toBe('404 NOT_FOUND');
  });
});
