import { NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import type { PublicErrorDetail } from '../../common/errors/public-details.js';
import { MAX_QUESTIONS_PER_ATTEMPT, SUBMIT_GRACE_MS } from './attempt.dto.js';
import type {
  AttemptReviewResponse, AttemptStatus, FinalAttemptStatus, QuestionSnapshot, ScoreSummary,
  StartAttemptResponse, SubmitAttemptResponse, SubmittedAnswer
} from './attempt.dto.js';
import { AttemptAlreadySubmittedError, AttemptExpiredError, AttemptNotSubmittedError, QuizNotAvailableError } from './attempt.errors.js';
import type { AttemptRecord, AttemptRepository, QuestionBankReader, QuizCatalogReader } from './attempt.ports.js';
import { calculateScore, clampTimeSpentSeconds, isPastGrace } from './score-calculator.js';
import type { ScoreResult } from './score-calculator.js';

export interface AttemptDependencies {
  readonly repository: AttemptRepository;
  readonly quizzes: QuizCatalogReader;
  readonly questions: QuestionBankReader;
  readonly now: () => Date;
}

function statusError(status: AttemptStatus): Error {
  if (status === 'EXPIRED') return new AttemptExpiredError();
  return new AttemptAlreadySubmittedError();
}

// Unknown or repeated question IDs and unknown option IDs are rejected before the
// attempt is claimed, so a malformed request never consumes the attempt.
function assertAnswersMatch(questions: readonly QuestionSnapshot[], answers: readonly SubmittedAnswer[]): void {
  const optionsByQuestion = new Map(questions.map(question => [question.questionId, new Set(question.options.map(option => option.optionId))]));
  const seen = new Set<string>();
  const details: PublicErrorDetail[] = [];
  answers.forEach((answer, index) => {
    const options = optionsByQuestion.get(answer.questionId);
    if (!options || seen.has(answer.questionId)) {
      details.push({ path: `answers.${index}.questionId`, code: 'custom' });
      return;
    }
    seen.add(answer.questionId);
    answer.selectedOptionIds.forEach((optionId, optionIndex) => {
      if (!options.has(optionId)) details.push({ path: `answers.${index}.selectedOptionIds.${optionIndex}`, code: 'custom' });
    });
  });
  if (details.length) throw new ValidationError('Invalid request', details);
}

function summaryOf(attempt: AttemptRecord): ScoreSummary {
  return {
    scorePercentage: attempt.scorePercentage ?? 0, correctCount: attempt.correctCount ?? 0,
    incorrectCount: attempt.incorrectCount ?? attempt.questionsCount, earnedPoints: attempt.earnedPoints ?? 0,
    totalPoints: attempt.totalPoints, passed: attempt.passed ?? false, timeSpentSeconds: attempt.timeSpentSeconds ?? 0
  };
}

export class AttemptService {
  constructor(private readonly dependencies: AttemptDependencies) {}

  async startAttempt(studentId: string, quizId: string): Promise<StartAttemptResponse> {
    const { quizzes, questions, repository, now } = this.dependencies;
    const quiz = await quizzes.findQuiz(quizId);
    // Unpublished quizzes are invisible to students.
    if (!quiz || !quiz.isPublished) throw new NotFoundError('Quiz');
    // BR-07: a quiz needs a duration and at least one valid question.
    if (!Number.isInteger(quiz.durationMinutes) || quiz.durationMinutes < 1) throw new QuizNotAvailableError();
    const snapshot = await questions.listQuestions(quizId, MAX_QUESTIONS_PER_ATTEMPT + 1);
    if (snapshot.length === 0 || snapshot.length > MAX_QUESTIONS_PER_ATTEMPT) throw new QuizNotAvailableError();
    // BR-11: the timer is set by the server only.
    const startedAt = now();
    const attempt = await repository.create({
      studentId, quizId, quizTitle: quiz.title, quizImageUrl: quiz.imageUrl,
      durationMinutes: quiz.durationMinutes, passingScorePercentage: quiz.passingScorePercentage,
      startedAt, expiresAt: new Date(startedAt.getTime() + quiz.durationMinutes * 60_000), questions: snapshot
    });
    // BR-10: no answer key while the attempt is in progress.
    return {
      attemptId: attempt.attemptId, quizTitle: attempt.quizTitle, durationMinutes: attempt.durationMinutes,
      startedAt: attempt.startedAt.toISOString(), expiresAt: attempt.expiresAt.toISOString(),
      questions: attempt.questions.map(question => ({
        questionId: question.questionId, text: question.text, type: question.type, points: question.points,
        options: question.options.map(option => ({ optionId: option.optionId, text: option.text }))
      }))
    };
  }

  async submitAttempt(studentId: string, attemptId: string, answers: readonly SubmittedAnswer[]): Promise<SubmitAttemptResponse> {
    const { repository, now } = this.dependencies;
    const attempt = await repository.findOwned(attemptId, studentId);
    if (!attempt) throw new NotFoundError('Attempt');
    if (attempt.status !== 'IN_PROGRESS') throw statusError(attempt.status);
    // Late submissions are not graded, so their answers are not validated either.
    if (!isPastGrace(attempt.expiresAt, now(), SUBMIT_GRACE_MS)) assertAnswersMatch(attempt.questions, answers);

    // BR-12: only one request can move the attempt out of IN_PROGRESS.
    if (!await repository.claimForSubmission(attemptId, studentId)) {
      const latest = await repository.findOwned(attemptId, studentId);
      throw latest ? statusError(latest.status === 'IN_PROGRESS' ? 'SUBMITTING' : latest.status) : new NotFoundError('Attempt');
    }
    let finalized = false;
    try {
      const finishedAt = now();
      const timeSpentSeconds = clampTimeSpentSeconds(attempt.startedAt, finishedAt, attempt.durationMinutes);
      if (isPastGrace(attempt.expiresAt, finishedAt, SUBMIT_GRACE_MS)) {
        // BR-11: past the grace window the attempt is stored as EXPIRED with zero score.
        const zero = calculateScore(attempt.questions, [], attempt.passingScorePercentage);
        finalized = await this.finalize(attempt, 'EXPIRED', finishedAt, timeSpentSeconds, [], { ...zero, scorePercentage: 0, passed: false });
        throw new AttemptExpiredError();
      }
      const score = calculateScore(attempt.questions, answers, attempt.passingScorePercentage);
      finalized = await this.finalize(attempt, 'SUBMITTED', finishedAt, timeSpentSeconds, answers, score);
      if (!finalized) throw new AttemptAlreadySubmittedError();
      return {
        attemptId, scorePercentage: score.scorePercentage, correctCount: score.correctCount,
        incorrectCount: score.incorrectCount, earnedPoints: score.earnedPoints, totalPoints: score.totalPoints,
        passed: score.passed, timeSpentSeconds
      };
    } catch (error: unknown) {
      // Return the attempt to IN_PROGRESS so the student can retry after a failure.
      if (!finalized) await repository.releaseClaim(attemptId).catch(() => undefined);
      throw error;
    }
  }

  async reviewAttempt(studentId: string, attemptId: string): Promise<AttemptReviewResponse> {
    const { repository, now } = this.dependencies;
    let attempt = await repository.findOwned(attemptId, studentId);
    if (!attempt) throw new NotFoundError('Attempt');
    if (attempt.status === 'IN_PROGRESS' && isPastGrace(attempt.expiresAt, now(), SUBMIT_GRACE_MS)) {
      // Finalize an abandoned attempt now instead of waiting for the sweeper.
      await repository.expireOverdue(now(), { attemptId, studentId });
      attempt = await repository.findOwned(attemptId, studentId);
      if (!attempt) throw new NotFoundError('Attempt');
    }
    const status = attempt.status;
    // BR-10: no answer key while the attempt can still be answered.
    if (status !== 'SUBMITTED' && status !== 'EXPIRED') throw new AttemptNotSubmittedError();
    const score = calculateScore(attempt.questions, attempt.answers, attempt.passingScorePercentage);
    return {
      attemptId: attempt.attemptId, quizId: attempt.quizId, quizTitle: attempt.quizTitle, status,
      submittedAt: (attempt.submittedAt ?? attempt.expiresAt).toISOString(), ...summaryOf(attempt),
      questions: attempt.questions.map((question, index) => {
        const grade = score.grades[index];
        return {
          questionId: question.questionId, text: question.text, type: question.type,
          options: question.options.map(option => ({ optionId: option.optionId, text: option.text })),
          selectedOptionIds: grade?.selectedOptionIds ?? [], correctOptionIds: [...question.correctOptionIds],
          isCorrect: grade?.isCorrect ?? false, pointsEarned: grade?.pointsEarned ?? 0, maxPoints: question.points
        };
      })
    };
  }

  private finalize(
    attempt: AttemptRecord, status: FinalAttemptStatus, submittedAt: Date, timeSpentSeconds: number,
    answers: readonly SubmittedAnswer[], score: ScoreResult
  ): Promise<boolean> {
    return this.dependencies.repository.finalize(attempt.attemptId, {
      status, submittedAt, timeSpentSeconds,
      answers: answers.map(answer => ({ questionId: answer.questionId, selectedOptionIds: [...new Set(answer.selectedOptionIds)] })),
      correctCount: score.correctCount, incorrectCount: score.incorrectCount, earnedPoints: score.earnedPoints,
      totalPoints: score.totalPoints, scorePercentage: score.scorePercentage, passed: score.passed,
      // Every question is listed, unanswered ones as incorrect (Dashboard contract).
      questionResults: score.grades.map(grade => ({ questionId: grade.questionId, isCorrect: grade.isCorrect }))
    });
  }
}
