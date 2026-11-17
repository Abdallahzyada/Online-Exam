import { Types } from 'mongoose';
import type { Connection, Collection, PipelineStage } from 'mongoose';
import { analyticsAttemptSchema } from './dashboard.dto.js';
import { MAX_QUESTION_RESULTS } from './analytics-limits.js';
import type { AnalyticsAttempt, DashboardKpis, HistoryEntry, HistoryQuery } from './dashboard.dto.js';
import type { DashboardErrors, DashboardRepository, HistoryRecords } from './dashboard.ports.js';

export function buildKpisPipeline(studentId: string): PipelineStage[] {
  return [
    { $match: { studentId: new Types.ObjectId(studentId), status: 'SUBMITTED' } },
    { $facet: {
      totals: [{ $group: {
        _id: null,
        quizzesPassed: { $sum: { $cond: ['$passed', 1, 0] } },
        totalCorrectAnswers: { $sum: '$correctCount' }
      } }],
      fastest: [
        { $match: { passed: true } },
        { $group: { _id: null, fastestTimeSeconds: { $min: '$timeSpentSeconds' } } }
      ]
    } }
  ];
}

export function buildHistoryPipeline(studentId: string, query: HistoryQuery): PipelineStage[] {
  return [
    { $match: { studentId: new Types.ObjectId(studentId), status: { $in: ['SUBMITTED', 'EXPIRED'] } } },
    { $sort: { submittedAt: -1, _id: -1 } },
    { $facet: {
      entries: [
        { $skip: (query.page - 1) * query.limit }, { $limit: query.limit },
        { $project: {
          _id: 0, attemptId: { $toString: '$_id' }, quizId: { $toString: '$quizId' },
          quizTitle: 1, quizImageUrl: { $ifNull: ['$quizImageUrl', null] },
          questionsCount: 1, durationMinutes: 1, correctCount: 1,
          scorePercentage: 1, passed: 1, timeSpentSeconds: 1,
          submittedAt: { $dateToString: { date: '$submittedAt', format: '%Y-%m-%dT%H:%M:%S.%LZ', timezone: '+00:00' } }
        } }
      ],
      totals: [{ $count: 'count' }]
    } }
  ];
}

interface KpiFacet {
  totals: { quizzesPassed: number; totalCorrectAnswers: number }[];
  fastest: { fastestTimeSeconds: number }[];
}
interface HistoryFacet {
  entries: HistoryEntry[];
  totals: { count: number }[];
}
export interface DashboardRepositoryOptions {
  readonly connection: Connection;
  readonly attemptCollection: string;
  readonly errors: DashboardErrors;
}

export class MongooseDashboardRepository implements DashboardRepository {
  private readonly attempts: Collection;

  constructor(private readonly options: DashboardRepositoryOptions) {
    this.attempts = options.connection.collection(options.attemptCollection);
  }

  async getKpis(studentId: string): Promise<DashboardKpis> {
    const [summary] = await this.attempts.aggregate<KpiFacet>(buildKpisPipeline(studentId)).toArray();
    return {
      quizzesPassed: summary?.totals[0]?.quizzesPassed ?? 0,
      totalCorrectAnswers: summary?.totals[0]?.totalCorrectAnswers ?? 0,
      fastestTimeSeconds: summary?.fastest[0]?.fastestTimeSeconds ?? null
    };
  }

  async getHistory(studentId: string, query: HistoryQuery): Promise<HistoryRecords> {
    const [history] = await this.attempts.aggregate<HistoryFacet>(buildHistoryPipeline(studentId, query)).toArray();
    return { entries: history?.entries ?? [], total: history?.totals[0]?.count ?? 0 };
  }

  async getAnalyticsAttempts(quizId: string): Promise<readonly AnalyticsAttempt[]> {
    const cursor = this.attempts.aggregate<Record<string, unknown>>([
      { $match: { quizId: new Types.ObjectId(quizId), status: 'SUBMITTED' } },
      { $sort: { _id: 1 } },
      { $limit: 10_001 },
      { $project: {
        _id: 0, attemptId: { $toString: '$_id' }, scorePercentage: 1,
        timeSpentSeconds: 1, questionResults: { $slice: ['$questionResults', 1001] }
      } }
    ], { batchSize: 100, timeoutMS: 5000 });
    const attempts: AnalyticsAttempt[] = [];
    let questionResults = 0;
    try {
      for await (const document of cursor) {
        if (attempts.length === 10_000) throw this.options.errors.analyticsLimit();
        if (Array.isArray(document.questionResults) && document.questionResults.length > 1000) {
          throw this.options.errors.analyticsLimit();
        }
        const parsed = analyticsAttemptSchema.safeParse(document);
        if (!parsed.success) throw new Error('Stored analytics data does not match the shared contract');
        questionResults += parsed.data.questionResults.length;
        if (questionResults > MAX_QUESTION_RESULTS) throw this.options.errors.analyticsLimit();
        attempts.push(parsed.data);
      }
      return attempts;
    } finally {
      await cursor.close();
    }
  }
}
