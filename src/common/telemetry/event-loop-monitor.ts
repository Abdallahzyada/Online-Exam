import { monitorEventLoopDelay } from 'node:perf_hooks';

export interface EventLoopSnapshot {
  readonly meanDelayMs: number;
  readonly maxDelayMs: number;
  readonly p99DelayMs: number;
}

/** The parts of the perf_hooks histogram the monitor reads. Tests inject a fake. */
export type DelayHistogram = Pick<ReturnType<typeof monitorEventLoopDelay>, 'enable' | 'disable' | 'reset' | 'percentile' | 'mean' | 'max' | 'count'>;

export interface EventLoopMonitorOptions {
  /** Length of one measurement window. Health reports the last complete window. */
  readonly windowMs?: number;
  readonly histogram?: DelayHistogram;
}

const EMPTY: EventLoopSnapshot = { meanDelayMs: 0, maxDelayMs: 0, p99DelayMs: 0 };

// Values are reset every window so health shows current lag, not an average
// since startup that hides a saturation happening now.
export class EventLoopMonitor {
  private readonly histogram: DelayHistogram;
  private readonly windowMs: number;
  private windowTimer: ReturnType<typeof setInterval> | undefined;
  private lastWindow: EventLoopSnapshot | undefined;

  constructor(options: EventLoopMonitorOptions = {}) {
    this.windowMs = options.windowMs ?? 5_000;
    if (!Number.isInteger(this.windowMs) || this.windowMs < 100) throw new Error('Invalid event-loop window');
    this.histogram = options.histogram ?? monitorEventLoopDelay({ resolution: 10 });
  }

  start(): void {
    if (this.windowTimer) return;
    // A new run starts clean, so a restart never reports the previous run's window or samples.
    this.lastWindow = undefined;
    this.histogram.reset();
    this.histogram.enable();
    this.windowTimer = setInterval(() => this.closeWindow(), this.windowMs);
    this.windowTimer.unref();
  }

  stop(): void {
    clearInterval(this.windowTimer);
    this.windowTimer = undefined;
    this.histogram.disable();
  }

  /** The last complete window; before the first one ends, everything since start. */
  snapshot(): EventLoopSnapshot {
    return this.lastWindow ?? this.read();
  }

  private closeWindow(): void {
    this.lastWindow = this.read();
    this.histogram.reset();
  }

  private read(): EventLoopSnapshot {
    if (this.histogram.count === 0) return EMPTY;
    const milliseconds = (value: number) => Number.isFinite(value) ? value / 1_000_000 : 0;
    return {
      meanDelayMs: milliseconds(this.histogram.mean),
      maxDelayMs: milliseconds(this.histogram.max),
      p99DelayMs: milliseconds(this.histogram.percentile(99))
    };
  }
}
