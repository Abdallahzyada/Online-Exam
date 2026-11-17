import { describe, expect, it, jest } from '@jest/globals';
import { Aggregator } from 'mingo';
import { Types } from 'mongoose';
import type { Connection, PipelineStage } from 'mongoose';
import { buildHistoryPipeline, buildKpisPipeline, MongooseDashboardRepository } from './dashboard.repository.js';
import { makeAttempt, makeDependencies, quizId, studentId } from './testing/fixtures.js';

const otherStudent = 'aaaaaaaaaaaaaaaaaaaaaaaa';
function storedAttempt(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: index.toString(16).padStart(24, '0'),
    studentId: new Types.ObjectId(studentId), quizId,
    status: 'SUBMITTED', passed: true, timeSpentSeconds: 100, correctCount: 5,
    quizTitle: 'HTML', quizImageUrl: null, questionsCount: 10,
    durationMinutes: 15, scorePercentage: 50, submittedAt: new Date('2026-01-01T12:00:00Z'),
    correctOptionIds: ['private-answer'], ...overrides
  };
}

function repositoryWith(collection: unknown): MongooseDashboardRepository {
  // The fake replaces only Mongoose's connection boundary, never the repository under test.
  const connection = { collection: () => collection } as unknown as Connection;
  return new MongooseDashboardRepository({ connection, attemptCollection: 'quizattempts', errors: makeDependencies().errors });
}

describe('dashboard MongoDB aggregation semantics', () => {
  it('counts passed submissions, excludes failed speed runs, and sums failed-attempt correct answers', async () => {
    const documents = [
      storedAttempt(1, { timeSpentSeconds: 120, correctCount: 8 }),
      storedAttempt(2, { passed: false, timeSpentSeconds: 0, correctCount: 3 }),
      storedAttempt(3, { status: 'IN_PROGRESS', timeSpentSeconds: 1, correctCount: 100 }),
      storedAttempt(4, { status: 'EXPIRED', passed: false, correctCount: 100 }),
      storedAttempt(5, { studentId: new Types.ObjectId(otherStudent), correctCount: 100 })
    ];
    const collection = { aggregate: (pipeline: PipelineStage[]) => ({ toArray: async () => new Aggregator(pipeline.map(stage => Object.fromEntries(Object.entries(stage)))).run(documents) }) };
    expect(await repositoryWith(collection).getKpis(studentId)).toEqual({ quizzesPassed: 1, fastestTimeSeconds: 120, totalCorrectAnswers: 11 });
  });

  it('returns null fastest time and retains correct answers when every attempt failed', async () => {
    const collection = { aggregate: (pipeline: PipelineStage[]) => ({ toArray: async () => new Aggregator(pipeline.map(stage => Object.fromEntries(Object.entries(stage)))).run([storedAttempt(1, { passed: false, correctCount: 4 })]) }) };
    expect(await repositoryWith(collection).getKpis(studentId)).toEqual({ quizzesPassed: 0, fastestTimeSeconds: null, totalCorrectAnswers: 4 });
  });

  it('returns zero KPIs and null fastest time with no attempts', async () => {
    const collection = { aggregate: (pipeline: PipelineStage[]) => ({ toArray: async () => new Aggregator(pipeline.map(stage => Object.fromEntries(Object.entries(stage)))).run([]) }) };
    expect(await repositoryWith(collection).getKpis(studentId)).toEqual({ quizzesPassed: 0, fastestTimeSeconds: null, totalCorrectAnswers: 0 });
  });

  it('returns empty history and KPIs if an aggregation produces no facet document', async () => {
    const collection = { aggregate: () => ({ toArray: async () => [] }) };
    const repository = repositoryWith(collection);
    expect(await repository.getHistory(studentId, { page: 1, limit: 10 })).toEqual({ entries: [], total: 0 });
    expect((await repository.getKpis(studentId)).fastestTimeSeconds).toBeNull();
  });

  it('scopes history to the student, includes expired attempts and applies stable newest-first pagination', async () => {
    const documents = [
      storedAttempt(1), storedAttempt(2, { status: 'EXPIRED', passed: false }),
      storedAttempt(3, { status: 'IN_PROGRESS' }),
      storedAttempt(4, { studentId: new Types.ObjectId(otherStudent) })
    ];
    const collection = { aggregate: (pipeline: PipelineStage[]) => ({ toArray: async () => new Aggregator(pipeline.map(stage => Object.fromEntries(Object.entries(stage)))).run(documents) }) };
    const history = await repositoryWith(collection).getHistory(studentId, { page: 1, limit: 1 });
    expect(history.total).toBe(2);
    expect(history.entries).toEqual([{
      attemptId: '000000000000000000000002', quizId, quizTitle: 'HTML', quizImageUrl: null,
      questionsCount: 10, durationMinutes: 15, correctCount: 5, scorePercentage: 50,
      passed: false, timeSpentSeconds: 100, submittedAt: '2026-01-01T12:00:00.000Z'
    }]);
  });

  it('keeps the full total when the requested history page is empty', async () => {
    const collection = { aggregate: (pipeline: PipelineStage[]) => ({ toArray: async () => new Aggregator(pipeline.map(stage => Object.fromEntries(Object.entries(stage)))).run([storedAttempt(1)]) }) };
    expect(await repositoryWith(collection).getHistory(studentId, { page: 2, limit: 10 })).toEqual({ entries: [], total: 1 });
  });

  it('casts the token identity to ObjectId before either aggregation', () => {
    expect(buildKpisPipeline(studentId)[0]).toEqual({ $match: { studentId: new Types.ObjectId(studentId), status: 'SUBMITTED' } });
    expect(buildHistoryPipeline(studentId, { page: 1, limit: 10 })[0]).toEqual({
      $match: { studentId: new Types.ObjectId(studentId), status: { $in: ['SUBMITTED', 'EXPIRED'] } }
    });
  });
});

describe('analytics repository cursor', () => {
  it('maps a per-attempt limit to the public size error and closes its cursor', async () => {
    const close = jest.fn<() => Promise<void>>().mockResolvedValue();
    const cursor = { async *[Symbol.asyncIterator]() {
      yield { ...makeAttempt(1, 50, 10), questionResults: Array.from({ length: 1001 }, () => ({ questionId: quizId, isCorrect: true })) };
    }, close };
    await expect(repositoryWith({ aggregate: () => cursor }).getAnalyticsAttempts(quizId)).rejects.toThrow('Analytics dataset limit reached');
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('closes timed-out database work so admission can be released', async () => {
    const timeout = Object.assign(new Error('Database operation timed out'), { name: 'MongoOperationTimeoutError' });
    const close = jest.fn<() => Promise<void>>().mockResolvedValue();
    const cursor = { async *[Symbol.asyncIterator]() { throw timeout; yield {}; }, close };
    await expect(repositoryWith({ aggregate: () => cursor }).getAnalyticsAttempts(quizId)).rejects.toBe(timeout);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('stops and closes the cursor when total question results exceed the job budget', async () => {
    const close = jest.fn<() => Promise<void>>().mockResolvedValue();
    let documentsRead = 0;
    const questions = Array.from({ length: 1000 }, (_, index) => ({ questionId: index.toString(16).padStart(24, '0'), isCorrect: true }));
    const cursor = { async *[Symbol.asyncIterator]() {
      for (let index = 0; index < 200; index++) {
        documentsRead++;
        yield { ...makeAttempt(index, 50, 10), questionResults: questions };
      }
    }, close };
    await expect(repositoryWith({ aggregate: () => cursor }).getAnalyticsAttempts(quizId)).rejects.toThrow('Analytics dataset limit reached');
    expect(documentsRead).toBe(101);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('reads validated summaries and closes the cursor', async () => {
    const attempt = makeAttempt(1, 50, 10);
    const close = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const cursor = { async *[Symbol.asyncIterator]() { yield attempt; }, close };
    const aggregate = jest.fn().mockReturnValue(cursor);
    expect(await repositoryWith({ aggregate }).getAnalyticsAttempts(quizId)).toEqual([attempt]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $match: { quizId: new Types.ObjectId(quizId), status: 'SUBMITTED' } }, { $limit: 10_001 }
    ]), { batchSize: 100, timeoutMS: 5000 });
  });

  it('closes the cursor on invalid persisted analytics data', async () => {
    const close = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const cursor = { async *[Symbol.asyncIterator]() { yield { scorePercentage: -1 }; }, close };
    await expect(repositoryWith({ aggregate: () => cursor }).getAnalyticsAttempts(quizId)).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized datasets instead of silently reporting partial statistics', async () => {
    const close = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const cursor = {
      async *[Symbol.asyncIterator]() { for (let index = 0; index < 10_001; index++) yield makeAttempt(index, 50, 10); }, close
    };
    await expect(repositoryWith({ aggregate: () => cursor }).getAnalyticsAttempts(quizId)).rejects.toThrow('Analytics dataset limit reached');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('propagates database cursor errors and still closes the cursor', async () => {
    const close = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const cursor = { async *[Symbol.asyncIterator]() { yield makeAttempt(1, 50, 10); throw new Error('Database read failed'); }, close };
    await expect(repositoryWith({ aggregate: () => cursor }).getAnalyticsAttempts(quizId)).rejects.toThrow('Database read failed');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
