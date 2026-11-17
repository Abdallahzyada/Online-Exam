import type { AnalyticsPayload, AnalyticsResponse } from './dashboard.dto.js';
import type { AnalyticsExecutor, SharedWorkerPort } from './dashboard.ports.js';

export class DashboardAnalyticsAdapter implements AnalyticsExecutor {
  constructor(private readonly workers: SharedWorkerPort) {}

  withCapacity<T>(work: () => Promise<T>): Promise<T> {
    return this.workers.withCapacity(work);
  }

  execute(payload: AnalyticsPayload): Promise<AnalyticsResponse> {
    return this.workers.run({ taskType: 'quiz-analytics', payload });
  }
}
