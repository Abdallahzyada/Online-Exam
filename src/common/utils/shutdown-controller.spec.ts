import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { createShutdownController, registerShutdownSignals } from './shutdown-controller.js';

afterEach(() => { jest.useRealTimers(); });
describe('shutdown deadline and repeated signals', () => {
  it('keeps the force-exit deadline after cleanup rejects', async () => {
    jest.useFakeTimers();
    const forceExit = jest.fn(), report = jest.fn(), setExitCode = jest.fn();
    const stop = createShutdownController({ shutdown: async () => { throw new Error('Active worker handle'); }, forceExit, report, setExitCode, deadlineMs: 100 });
    stop();
    await jest.advanceTimersByTimeAsync(0);
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(forceExit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(100);
    expect(forceExit).toHaveBeenCalledTimes(1);
  });
  it('routes repeated signals to the guard until draining finishes', async () => {
    jest.useFakeTimers();
    let finish: (() => void) | undefined;
    const draining = new Promise<void>(resolve => { finish = resolve; });
    const shutdown = jest.fn<() => Promise<void>>().mockReturnValue(draining);
    const source = new EventEmitter();
    const stop = createShutdownController({ shutdown, forceExit: jest.fn(), report: jest.fn(), setExitCode: jest.fn() });
    const unregister = registerShutdownSignals(source, () => stop());
    source.emit('SIGTERM'); source.emit('SIGTERM'); source.emit('SIGINT');
    await jest.advanceTimersByTimeAsync(0);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(source.listenerCount('SIGTERM')).toBe(1);
    finish?.();
    await draining;
    unregister();
    expect(source.listenerCount('SIGTERM')).toBe(0);
  });
});
