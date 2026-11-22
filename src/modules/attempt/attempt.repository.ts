import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { STALE_CLAIM_MS, SUBMIT_GRACE_MS } from './attempt.dto.js';
import type { AttemptDocument } from './attempt.model.js';
import type {
  AttemptRecord, AttemptRepository, ExpireOverdueScope, FinalizedAttempt, NewAttempt
} from './attempt.ports.js';

const objectId = (value: string) => new Types.ObjectId(value);

export function toAttemptRecord(document: AttemptDocument): AttemptRecord {
  return {
    attemptId: document._id.toHexString(), studentId: document.studentId.toHexString(),
    quizId: document.quizId.toHexString(), status: document.status,
    quizTitle: document.quizTitle, quizImageUrl: document.quizImageUrl ?? null,
    questionsCount: document.questionsCount, durationMinutes: document.durationMinutes,
    passingScorePercentage: document.passingScorePercentage,
    startedAt: document.startedAt, expiresAt: document.expiresAt, submittedAt: document.submittedAt ?? null,
    questions: document.questions.map(question => ({
      questionId: question.questionId, text: question.text, type: question.type, points: question.points,
      options: question.options.map(option => ({ optionId: option.optionId, text: option.text ?? '' })),
      correctOptionIds: [...question.correctOptionIds]
    })),
    answers: (document.answers ?? []).map(answer => ({
      questionId: answer.questionId, selectedOptionIds: [...answer.selectedOptionIds]
    })),
    timeSpentSeconds: document.timeSpentSeconds ?? null, correctCount: document.correctCount ?? null,
    incorrectCount: document.incorrectCount ?? null, earnedPoints: document.earnedPoints ?? null,
    totalPoints: document.totalPoints, scorePercentage: document.scorePercentage ?? null,
    passed: document.passed ?? null
  };
}

// Abandoned attempts finalize as EXPIRED with a zero score, in one server-side update.
// A stale SUBMITTING claim (process crashed mid-submit) is expired after a longer delay.
export function buildExpireOverdue(now: Date, scope: ExpireOverdueScope = {}) {
  const deadline = new Date(now.getTime() - SUBMIT_GRACE_MS);
  const staleClaimDeadline = new Date(deadline.getTime() - STALE_CLAIM_MS);
  const filter: Record<string, unknown> = { $or: [
    { status: 'IN_PROGRESS', expiresAt: { $lt: deadline } },
    { status: 'SUBMITTING', expiresAt: { $lt: staleClaimDeadline } }
  ] };
  if (scope.attemptId) filter._id = objectId(scope.attemptId);
  if (scope.studentId) filter.studentId = objectId(scope.studentId);
  const update = [{ $set: {
    status: 'EXPIRED', submittedAt: now,
    timeSpentSeconds: { $multiply: ['$durationMinutes', 60] },
    answers: { $literal: [] }, correctCount: 0, incorrectCount: { $size: '$questions' },
    earnedPoints: 0, totalPoints: { $sum: '$questions.points' }, scorePercentage: 0, passed: false,
    questionResults: { $map: { input: '$questions', as: 'question', in: { questionId: '$$question.questionId', isCorrect: false } } }
  } }];
  return { filter, update };
}

export class MongooseAttemptRepository implements AttemptRepository {
  constructor(private readonly model: Model<AttemptDocument>) {}

  async create(attempt: NewAttempt): Promise<AttemptRecord> {
    const created = await this.model.create({
      studentId: objectId(attempt.studentId), quizId: objectId(attempt.quizId), status: 'IN_PROGRESS',
      quizTitle: attempt.quizTitle, quizImageUrl: attempt.quizImageUrl,
      questionsCount: attempt.questions.length, durationMinutes: attempt.durationMinutes,
      passingScorePercentage: attempt.passingScorePercentage,
      totalPoints: attempt.questions.reduce((sum, question) => sum + question.points, 0),
      startedAt: attempt.startedAt, expiresAt: attempt.expiresAt,
      questions: attempt.questions.map(question => ({ ...question })), answers: [], questionResults: []
    });
    return toAttemptRecord(created.toObject());
  }

  async findOwned(attemptId: string, studentId: string): Promise<AttemptRecord | null> {
    const document = await this.model.findOne({ _id: objectId(attemptId), studentId: objectId(studentId) })
      .lean<AttemptDocument>().exec();
    return document ? toAttemptRecord(document) : null;
  }

  async claimForSubmission(attemptId: string, studentId: string): Promise<boolean> {
    const result = await this.model.updateOne(
      { _id: objectId(attemptId), studentId: objectId(studentId), status: 'IN_PROGRESS' },
      { $set: { status: 'SUBMITTING' } }
    ).exec();
    return result.modifiedCount === 1;
  }

  async finalize(attemptId: string, result: FinalizedAttempt): Promise<boolean> {
    const updated = await this.model.updateOne(
      { _id: objectId(attemptId), status: 'SUBMITTING' },
      { $set: {
        ...result,
        answers: result.answers.map(answer => ({ ...answer })),
        questionResults: result.questionResults.map(entry => ({ ...entry }))
      } }
    ).exec();
    return updated.modifiedCount === 1;
  }

  async releaseClaim(attemptId: string): Promise<void> {
    await this.model.updateOne({ _id: objectId(attemptId), status: 'SUBMITTING' }, { $set: { status: 'IN_PROGRESS' } }).exec();
  }

  async expireOverdue(now: Date, scope: ExpireOverdueScope = {}): Promise<number> {
    const { filter, update } = buildExpireOverdue(now, scope);
    // Pipeline updates go through the driver collection; Mongoose would recast them.
    const result = await this.model.collection.updateMany(filter, update);
    return result.modifiedCount;
  }
}
