import { z } from 'zod';
import type { AnalyticsPayload } from '../../modules/dashboard/dashboard.dto.js';
import { analyticsResponseSchema } from '../../modules/dashboard/dashboard.dto.js';

export interface AnalyticsTask {
  readonly taskType: 'quiz-analytics';
  readonly payload: AnalyticsPayload;
}
export const workerRequestSchema = z.object({
  requestId: z.number().int().positive(), taskType: z.literal('quiz-analytics'), payload: z.unknown()
});
export const workerReplySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('result'), requestId: z.number().int(), result: analyticsResponseSchema }),
  z.object({ type: z.literal('error'), requestId: z.number().int(), message: z.string() })
]);
