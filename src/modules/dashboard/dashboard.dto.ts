import { z } from 'zod';
import { paginationSchema } from '../../common/utils/pagination.js';
import { MAX_ANALYTICS_ATTEMPTS, MAX_QUESTIONS_PER_ATTEMPT, questionResultCount } from './analytics-limits.js';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid resource ID').transform(value => value.toLowerCase());
export const historyQuerySchema = paginationSchema;
export const analyticsParamsSchema = z.object({ quizId: objectIdSchema }).strict();
export const emptyQuerySchema = z.object({}).strict();
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export interface StudentProfile {
  readonly firstName: string;
  readonly lastName: string;
  readonly avatarUrl: string | null;
}
export interface DashboardKpis {
  readonly quizzesPassed: number;
  readonly fastestTimeSeconds: number | null;
  readonly totalCorrectAnswers: number;
}
export interface DashboardResponse {
  readonly profile: StudentProfile;
  readonly kpis: DashboardKpis;
}
export interface HistoryEntry {
  readonly attemptId: string;
  readonly quizId: string;
  readonly quizTitle: string;
  readonly quizImageUrl: string | null;
  readonly questionsCount: number;
  readonly durationMinutes: number;
  readonly correctCount: number;
  readonly scorePercentage: number;
  readonly passed: boolean;
  readonly timeSpentSeconds: number;
  readonly submittedAt: string;
}
export interface PageMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}
export interface HistoryPage {
  readonly entries: readonly HistoryEntry[];
  readonly meta: PageMeta;
}

const questionResultSchema = z.object({
  questionId: objectIdSchema,
  isCorrect: z.boolean()
}).strict();
export const analyticsAttemptSchema = z.object({
  attemptId: objectIdSchema,
  scorePercentage: z.number().finite().min(0).max(100),
  timeSpentSeconds: z.number().finite().nonnegative(),
  questionResults: z.array(questionResultSchema).max(MAX_QUESTIONS_PER_ATTEMPT)
}).strict();
export const analyticsPayloadSchema = z.preprocess((payload, context) => {
  if (questionResultCount(payload) === null) {
    context.addIssue({ code: 'custom', message: 'Invalid analytics payload or aggregate question-result limit exceeded' });
    return z.NEVER;
  }
  return payload;
}, z.object({ attempts: z.array(analyticsAttemptSchema).max(MAX_ANALYTICS_ATTEMPTS) }).strict());
export type AnalyticsAttempt = z.infer<typeof analyticsAttemptSchema>;
export type AnalyticsPayload = z.infer<typeof analyticsPayloadSchema>;
export const analyticsResponseSchema = z.object({
  scoreDistribution: z.array(z.object({ from: z.number(), to: z.number(), count: z.number().int().nonnegative() })).length(10),
  percentileRankings: z.array(z.object({ attemptId: objectIdSchema, percentile: z.number().min(0).max(100) })).max(10_000),
  latency: z.object({ p50: z.number().nonnegative().nullable(), p90: z.number().nonnegative().nullable() }),
  questions: z.array(z.object({
    questionId: objectIdSchema, itemDiscrimination: z.number().min(-1).max(1).nullable(),
    failureRate: z.number().min(0).max(1)
  }))
});
export interface AnalyticsResponse {
  readonly scoreDistribution: readonly { from: number; to: number; count: number }[];
  readonly percentileRankings: readonly { attemptId: string; percentile: number }[];
  readonly latency: { readonly p50: number | null; readonly p90: number | null };
  readonly questions: readonly {
    questionId: string;
    itemDiscrimination: number | null;
    failureRate: number;
  }[];
}
