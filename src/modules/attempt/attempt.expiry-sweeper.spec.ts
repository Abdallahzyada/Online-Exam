import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createExpirySweeper } from './attempt.expiry-sweeper.js';

afterEach(() => { jest.useRealTimers(); });

function setup(expireOverdue = jest.fn<(now: Date) => Promise<number>>().mockResolvedValue(0)) {
  const report = jest.fn();
  const now = new Date('2026-11-21T10:00:00.000Z');
  const sweeper = createExpirySweeper({ repository: { expireOverdue }, now: () => now, report, intervalMs: 1000 });
  return { sweeper, expireOverdue, report, now };
}

describe('attempt expiry sweeper', () => {
  it('expires overdue attempts on each interval and stops cleanly', async () => {
    jest.useFakeTimers();
    const { sweeper, expireOverdue, now } = setup();
    sweeper.start();
    sweeper.start();
    await jest.advanceTimersByTimeAsync(3000);
    expect(expireOverdue).toHaveBeenCalledTimes(3);
    expect(expireOverdue).toHaveBeenCalledWith(now);
    await sweeper.stop();
    await jest.advanceTimersByTimeAsync(3000);
    expect(expireOverdue).toHaveBeenCalledTimes(3);
  });

  it('never overlaps sweeps and waits for the running sweep on stop', async () => {
    let finish: (value: number) => void = () => undefined;
    const expireOverdue = jest.fn<(now: Date) => Promise<number>>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { sweeper } = setup(expireOverdue);
    const first = sweeper.sweep();
    const second = sweeper.sweep();
    expect(expireOverdue).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = sweeper.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish(2);
    await Promise.all([first, second, stopping]);
    expect(stopped).toBe(true);
  });

  it('reports failures without throwing', async () => {
    const failure = new Error('database down');
    const { sweeper, report } = setup(jest.fn<(now: Date) => Promise<number>>().mockRejectedValue(failure));
    await expect(sweeper.sweep()).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(failure);
  });
});
