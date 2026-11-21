import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { setTimeout } from 'node:timers/promises';
import { EventLoopMonitor } from './event-loop-monitor.js';
import type { DelayHistogram } from './event-loop-monitor.js';

// Stands in for perf_hooks' histogram, which reports nanoseconds.
function fakeHistogram() {
  const values = { count: 0, mean: Number.NaN, max: 0, p99: 0 };
  const histogram = {
    get count() { return values.count; },
    get mean() { return values.mean; },
    get max() { return values.max; },
    enable: jest.fn(() => true),
    disable: jest.fn(() => true),
    reset: jest.fn(() => { Object.assign(values, { count: 0, mean: Number.NaN, max: 0, p99: 0 }); }),
    percentile: jest.fn((_percentile: number) => values.p99)
  } satisfies DelayHistogram;
  const record = (meanMs: number, maxMs: number, p99Ms: number) => {
    Object.assign(values, { count: 500, mean: meanMs * 1e6, max: maxMs * 1e6, p99: p99Ms * 1e6 });
  };
  return { histogram, record };
}

afterEach(() => { jest.useRealTimers(); });

describe('event loop metrics', () => {
  it('returns finite zero values before the first observation', () => {
    const monitor = new EventLoopMonitor();
    expect(monitor.snapshot()).toEqual({ meanDelayMs: 0, maxDelayMs: 0, p99DelayMs: 0 });
  });

  it('records samples in milliseconds after starting', async () => {
    const monitor = new EventLoopMonitor();
    monitor.start();
    try {
      await setTimeout(60);
      const result = monitor.snapshot();
      expect(result.meanDelayMs).toBeGreaterThan(0);
      expect(result.maxDelayMs).toBeGreaterThanOrEqual(result.meanDelayMs);
      expect(Number.isFinite(result.p99DelayMs)).toBe(true);
    } finally { monitor.stop(); }
  });

  it('reports the last complete window, so an old spike does not stay in health forever', async () => {
    jest.useFakeTimers();
    const fake = fakeHistogram();
    const monitor = new EventLoopMonitor({ windowMs: 1_000, histogram: fake.histogram });
    monitor.start();
    fake.record(2, 180, 150); // a blocked loop during the first window
    expect(monitor.snapshot()).toEqual({ meanDelayMs: 2, maxDelayMs: 180, p99DelayMs: 150 });

    await jest.advanceTimersByTimeAsync(1_000);
    expect(fake.histogram.reset).toHaveBeenCalledTimes(1);
    fake.record(1, 12, 11); // the next window is still running
    expect(monitor.snapshot()).toEqual({ meanDelayMs: 2, maxDelayMs: 180, p99DelayMs: 150 });

    await jest.advanceTimersByTimeAsync(1_000);
    expect(monitor.snapshot()).toEqual({ meanDelayMs: 1, maxDelayMs: 12, p99DelayMs: 11 });
    monitor.stop();
  });

  it('reports zeros for a window without samples', async () => {
    jest.useFakeTimers();
    const fake = fakeHistogram();
    const monitor = new EventLoopMonitor({ windowMs: 1_000, histogram: fake.histogram });
    monitor.start();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(monitor.snapshot()).toEqual({ meanDelayMs: 0, maxDelayMs: 0, p99DelayMs: 0 });
    monitor.stop();
  });

  it('starts once and stops its window timer', async () => {
    jest.useFakeTimers();
    const fake = fakeHistogram();
    const monitor = new EventLoopMonitor({ windowMs: 1_000, histogram: fake.histogram });
    monitor.start();
    monitor.start();
    expect(fake.histogram.enable).toHaveBeenCalledTimes(1);
    monitor.stop();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(fake.histogram.disable).toHaveBeenCalledTimes(1);
    expect(fake.histogram.reset).not.toHaveBeenCalled();
  });

  it('rejects an invalid window length', () => {
    expect(() => new EventLoopMonitor({ windowMs: 0 })).toThrow('Invalid event-loop window');
  });
});
