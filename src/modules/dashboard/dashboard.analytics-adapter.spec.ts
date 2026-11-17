import { describe, expect, it, jest } from '@jest/globals';
import { DashboardAnalyticsAdapter } from './dashboard.analytics-adapter.js';
import type { SharedWorkerPort } from './dashboard.ports.js';
import { emptyAnalytics } from './testing/fixtures.js';

describe('DashboardAnalyticsAdapter', () => {
  it('runs database work only after the shared manager admits the request', async () => {
    const withCapacity = async <T>(work: () => Promise<T>): Promise<T> => work();
    const workers: SharedWorkerPort = { withCapacity, run: jest.fn<SharedWorkerPort['run']>().mockResolvedValue(emptyAnalytics) };
    const work = jest.fn<() => Promise<number>>().mockResolvedValue(7);
    await expect(new DashboardAnalyticsAdapter(workers).withCapacity(work)).resolves.toBe(7);
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('dispatches the agreed task to the existing worker manager', async () => {
    const workers: SharedWorkerPort = { withCapacity: async work => work(), run: jest.fn<SharedWorkerPort['run']>().mockResolvedValue(emptyAnalytics) };
    const analytics = await new DashboardAnalyticsAdapter(workers).execute({ attempts: [] });
    expect(analytics).toEqual(emptyAnalytics);
    expect(workers.run).toHaveBeenCalledWith({ taskType: 'quiz-analytics', payload: { attempts: [] } });
  });

  it('does not swallow a shared-worker timeout', async () => {
    const timeout = new Error('Worker timeout');
    const workers: SharedWorkerPort = { withCapacity: async work => work(), run: jest.fn<SharedWorkerPort['run']>().mockRejectedValue(timeout) };
    await expect(new DashboardAnalyticsAdapter(workers).execute({ attempts: [] })).rejects.toBe(timeout);
  });
});
