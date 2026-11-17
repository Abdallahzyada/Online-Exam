import { describe, it, expect } from '@jest/globals';
import { setTimeout } from 'node:timers/promises';
import { EventLoopMonitor } from './event-loop-monitor.js';

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
});
