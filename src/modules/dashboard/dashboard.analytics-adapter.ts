import type { AnalyticsPayload, AnalyticsResponse } from './dashboard.dto.js';
import type { AnalyticsExecutor, SharedWorkerPort } from './dashboard.ports.js';

export class DashboardAnalyticsAdapter implements AnalyticsExecutor {
  constructor(private readonly workers: SharedWorkerPort) {}

  execute(payload: AnalyticsPayload): Promise<AnalyticsResponse> {
    return this.workers.run({ taskType: 'quiz-analytics', payload });
  }
}
