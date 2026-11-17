import { jest, describe, it, expect } from '@jest/globals';
import { createShutdown } from './shutdown.js';

describe('graceful shutdown', () => {
  it('stops accepting work before closing the database, only once', async () => {
    const calls: string[] = [];
    const shutdown = createShutdown({
      stopHttp: async () => { calls.push('http'); }, stopWorkers: async () => { calls.push('workers'); },
      closeDatabase: async () => { calls.push('database'); }, stopMonitor: () => { calls.push('monitor'); }
    });
    const first = shutdown();
    expect(shutdown()).toBe(first);
    await first;
    expect(calls).toEqual(['http', 'workers', 'database', 'monitor']);
  });
  it('still closes database and monitor if draining workers fails', async () => {
    const closeDatabase = jest.fn<() => Promise<void>>().mockResolvedValue();
    const stopMonitor = jest.fn();
    const shutdown = createShutdown({
      stopHttp: async () => undefined, stopWorkers: async () => { throw new Error('Worker failed'); },
      closeDatabase, stopMonitor
    });
    await expect(shutdown()).rejects.toBeInstanceOf(AggregateError);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(stopMonitor).toHaveBeenCalledTimes(1);
  });
});
