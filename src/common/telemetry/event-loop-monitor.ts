import { monitorEventLoopDelay } from 'node:perf_hooks';

export class EventLoopMonitor {
  private readonly histogram = monitorEventLoopDelay({ resolution: 10 });
  start(): void { this.histogram.enable(); }
  stop(): void { this.histogram.disable(); }

  snapshot() {
    const milliseconds = (value: number) => Number.isFinite(value) ? value / 1_000_000 : 0;
    return {
      meanDelayMs: milliseconds(this.histogram.mean),
      maxDelayMs: milliseconds(this.histogram.max),
      p99DelayMs: this.histogram.count === 0 ? 0 : milliseconds(this.histogram.percentile(99))
    };
  }
}
