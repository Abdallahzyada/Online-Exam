import { EventEmitter } from 'node:events';
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { WorkerManager } from './worker-manager.js';
import type { WorkerHandle } from './worker-manager.js';
import type { AnalyticsTask } from './worker-protocol.js';
import { calculateQuizAnalytics } from '../../modules/dashboard/dashboard.analytics.js';

class FakeWorker extends EventEmitter implements WorkerHandle {
  readonly sent: unknown[] = [];
  postMessage = jest.fn((message: unknown) => { this.sent.push(message); });
  terminate = jest.fn<() => Promise<number>>().mockResolvedValue(0);
}
const task: AnalyticsTask = { taskType: 'quiz-analytics', payload: { attempts: [] } };
const result = calculateQuizAnalytics({ attempts: [] });

describe('shared worker lifecycle', () => {
  let handles: FakeWorker[];
  let manager: WorkerManager;
  function current(): FakeWorker {
    const worker = handles.at(-1);
    if (!worker) throw new Error('Test worker was not created');
    return worker;
  }
  beforeEach(() => {
    jest.useFakeTimers();
    handles = [];
    manager = new WorkerManager({ timeoutMs: 1000, maxPending: 2, factory: () => {
      const worker = new FakeWorker(); handles.push(worker); return worker;
    } });
    manager.start();
    current().emit('message', { type: 'ready' });
  });
  afterEach(async () => { await manager.close(); jest.useRealTimers(); });

  it('keeps one worker and correlates replies received out of order', async () => {
    manager.start();
    const first = manager.run(task);
    const second = manager.run(task);
    expect(handles).toHaveLength(1);
    expect(current().sent).toEqual([{ requestId: 1, ...task }, { requestId: 2, ...task }]);
    current().emit('message', { type: 'result', requestId: 2, result });
    current().emit('message', { type: 'result', requestId: 1, result });
    await expect(first).resolves.toEqual(result);
    await expect(second).resolves.toEqual(result);
  });

  it.each(['error', 'exit'] as const)('rejects every pending request on %s and recovers on a replacement', async event => {
    const old = current();
    const first = expect(manager.run(task)).rejects.toMatchObject({ statusCode: 500 });
    const second = expect(manager.run(task)).rejects.toMatchObject({ statusCode: 500 });
    if (event === 'error') old.emit('error', new Error('crash'));
    else old.emit('exit', 0);
    old.emit('exit', 1);
    await Promise.all([first, second]);
    expect(manager.isReady()).toBe(false);
    await jest.advanceTimersByTimeAsync(100);
    expect(handles).toHaveLength(2);
    current().emit('message', { type: 'ready' });
    const reply = manager.run(task);
    old.emit('message', { type: 'result', requestId: 3, result });
    current().emit('message', { type: 'result', requestId: 3, result });
    await expect(reply).resolves.toEqual(result);
  });

  it('limits pending work without spawning another worker', async () => {
    const first = manager.run(task);
    const second = manager.run(task);
    await expect(manager.run(task)).rejects.toMatchObject({ statusCode: 503 });
    expect(handles).toHaveLength(1);
    current().emit('message', { type: 'result', requestId: 1, result });
    current().emit('message', { type: 'result', requestId: 2, result });
    await Promise.all([first, second]);
  });

  it('terminates a stuck worker on timeout and frees pending work', async () => {
    const assertion = expect(manager.run(task)).rejects.toMatchObject({ code: 'WORKER_TIMEOUT' });
    const old = current();
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(old.terminate).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(100);
    expect(handles).toHaveLength(2);
  });

  it('rejects a calculation error without killing a healthy worker', async () => {
    const assertion = expect(manager.run(task)).rejects.toMatchObject({ code: 'ANALYTICS_FAILED' });
    current().emit('message', { type: 'error', requestId: 1, message: 'private details' });
    await assertion;
    expect(manager.isReady()).toBe(true);
    expect(current().terminate).not.toHaveBeenCalled();
  });

  it('rejects malformed replies and restarts', async () => {
    const assertion = expect(manager.run(task)).rejects.toMatchObject({ code: 'WORKER_PROTOCOL_ERROR' });
    current().emit('message', { type: 'result', requestId: 1, result: {} });
    await assertion;
    expect(manager.isReady()).toBe(false);
  });

  it('clears work and prevents respawn after shutdown', async () => {
    const assertion = expect(manager.run(task)).rejects.toMatchObject({ statusCode: 503 });
    const old = current();
    await manager.close();
    await assertion;
    old.emit('exit', 1);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(handles).toHaveLength(1);
    expect(() => manager.start()).toThrow('closed');
    await expect(manager.run(task)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('rejects a postMessage failure immediately', async () => {
    current().postMessage.mockImplementation(() => { throw new Error('Cannot clone'); });
    await expect(manager.run(task)).rejects.toMatchObject({ code: 'WORKER_FAILED' });
  });

  it('waits for the replacement readiness message and retries a startup timeout', async () => {
    current().emit('exit', 1);
    await jest.advanceTimersByTimeAsync(100);
    await expect(manager.run(task)).rejects.toMatchObject({ statusCode: 503 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(current().terminate).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(200);
    expect(handles).toHaveLength(3);
  });

  it('retries worker construction failures', async () => {
    await manager.close();
    const factory = jest.fn<() => WorkerHandle>().mockImplementationOnce(() => { throw new Error('Cannot start'); }).mockReturnValue(new FakeWorker());
    manager = new WorkerManager({ timeoutMs: 1000, maxPending: 1, factory });
    expect(() => manager.start()).toThrow('could not start');
    await jest.advanceTimersByTimeAsync(100);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
