import { Worker } from 'node:worker_threads';
import { AppError, ServiceUnavailableError } from '../errors/app-error.js';
import type { AnalyticsResponse } from '../../modules/dashboard/dashboard.dto.js';
import { workerReplySchema } from './worker-protocol.js';
import type { AnalyticsTask } from './worker-protocol.js';

export interface WorkerHandle {
  postMessage(message: unknown): void;
  terminate(): Promise<number>;
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
}
interface PendingRequest {
  readonly resolve: (result: AnalyticsResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}
export interface WorkerManagerOptions {
  readonly timeoutMs: number;
  readonly maxPending: number;
  readonly factory?: () => WorkerHandle;
  readonly report?: (error: unknown) => void;
}

export class WorkerManager {
  private worker: WorkerHandle | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 0;
  private stopped = false;
  private ready = false;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;

  constructor(private readonly options: WorkerManagerOptions) {
    if (!Number.isInteger(options.maxPending) || options.maxPending < 1 || options.timeoutMs < 1) {
      throw new Error('Invalid worker limits');
    }
  }

  start(): void {
    if (this.stopped) throw new ServiceUnavailableError('Worker manager is closed');
    if (this.worker || this.restartTimer) return;
    try {
      const worker: WorkerHandle = this.options.factory?.() ?? new Worker(new URL('./analytics.worker.js', import.meta.url));
      this.worker = worker;
      worker.on('message', message => this.receive(worker, message));
      worker.on('error', error => {
        this.options.report?.(error);
        this.fail(worker, new AppError(500, 'WORKER_FAILED', 'Analytics worker failed'));
      });
      worker.on('exit', () => this.fail(worker, new AppError(500, 'WORKER_EXITED', 'Analytics worker stopped unexpectedly')));
      this.readyTimer = setTimeout(() => this.fail(worker, new ServiceUnavailableError('Worker startup timed out')), this.options.timeoutMs);
    } catch (error: unknown) {
      this.options.report?.(error);
      this.scheduleRestart();
      throw new ServiceUnavailableError('Analytics worker could not start');
    }
  }

  isReady(): boolean { return this.ready && !this.stopped; }

  async run(task: AnalyticsTask): Promise<AnalyticsResponse> {
    if (!this.worker || !this.isReady()) throw new ServiceUnavailableError('Analytics worker is not ready');
    if (this.pending.size >= this.options.maxPending) throw new ServiceUnavailableError('Analytics queue is full');
    const worker = this.worker;
    const requestId = ++this.nextRequestId;
    return new Promise<AnalyticsResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(worker, new AppError(504, 'WORKER_TIMEOUT', 'Analytics request timed out'));
      }, this.options.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try { worker.postMessage({ requestId, ...task }); }
      catch { this.fail(worker, new AppError(500, 'WORKER_FAILED', 'Could not send analytics request')); }
    });
  }

  private receive(worker: WorkerHandle, message: unknown): void {
    if (worker !== this.worker || this.stopped) return;
    const parsed = workerReplySchema.safeParse(message);
    if (!parsed.success) {
      this.fail(worker, new AppError(500, 'WORKER_PROTOCOL_ERROR', 'Invalid analytics worker response'));
      return;
    }
    const reply = parsed.data;
    if (reply.type === 'ready') {
      clearTimeout(this.readyTimer);
      this.readyTimer = undefined;
      this.ready = true;
      this.failures = 0;
      return;
    }
    const pending = this.pending.get(reply.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(reply.requestId);
    if (reply.type === 'result') pending.resolve(reply.result);
    else pending.reject(new AppError(500, 'ANALYTICS_FAILED', 'Analytics calculation failed'));
  }

  private fail(worker: WorkerHandle, error: Error): void {
    if (worker !== this.worker) return;
    this.worker = undefined;
    this.ready = false;
    clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
    this.rejectPending(error);
    void worker.terminate().catch(error => this.options.report?.(error));
    if (!this.stopped) this.scheduleRestart();
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return;
    const delay = Math.min(5000, 100 * 2 ** Math.min(this.failures++, 6));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      try { this.start(); } catch (error: unknown) { this.options.report?.(error); }
    }, delay);
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.restartTimer);
    clearTimeout(this.readyTimer);
    this.restartTimer = undefined;
    this.readyTimer = undefined;
    this.rejectPending(new ServiceUnavailableError('Server is shutting down'));
    const worker = this.worker;
    this.worker = undefined;
    if (worker) await worker.terminate();
  }
}
