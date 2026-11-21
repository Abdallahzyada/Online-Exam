import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { createShutdownController, registerFatalErrorHandler, registerShutdownSignals } from './shutdown-controller.js';

afterEach(() => { jest.useRealTimers(); });
describe('shutdown deadline and repeated signals', () => {
  it('clears the deadline and exits with code 0 after successful cleanup', async () => {
    jest.useFakeTimers();
    const forceExit = jest.fn(), setExitCode = jest.fn(), exit = jest.fn();
    createShutdownController({ shutdown: async () => {}, exit, forceExit, report: jest.fn(), setExitCode, deadlineMs: 100 })();
    await jest.advanceTimersByTimeAsync(200);
    expect(forceExit).not.toHaveBeenCalled();
    expect(setExitCode).toHaveBeenLastCalledWith(0);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
  it('does not exit before cleanup has finished', async () => {
    jest.useFakeTimers();
    let finish: (() => void) | undefined;
    const exit = jest.fn();
    const stop = createShutdownController({ shutdown: () => new Promise<void>(resolve => { finish = resolve; }), exit, forceExit: jest.fn(), report: jest.fn(), setExitCode: jest.fn() });
    stop();
    await jest.advanceTimersByTimeAsync(0);
    expect(exit).not.toHaveBeenCalled();
    finish?.();
    await jest.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(0);
  });
  it('retains a later failure during cleanup and after cleanup completes', async () => {
    jest.useFakeTimers();
    let finish: (() => void) | undefined;
    const setExitCode = jest.fn(), exit = jest.fn();
    const stop = createShutdownController({ shutdown: () => new Promise<void>(resolve => { finish = resolve; }), exit, forceExit: jest.fn(), report: jest.fn(), setExitCode });
    stop();
    await jest.advanceTimersByTimeAsync(0);
    stop(1); stop(); finish?.();
    await jest.advanceTimersByTimeAsync(0);
    expect(setExitCode).toHaveBeenLastCalledWith(1);
    expect(exit).toHaveBeenCalledWith(1);
    stop();
    expect(setExitCode).toHaveBeenLastCalledWith(1);
  });
  it('keeps the force-exit deadline after cleanup rejects', async () => {
    jest.useFakeTimers();
    const forceExit = jest.fn(), report = jest.fn(), setExitCode = jest.fn(), exit = jest.fn();
    const stop = createShutdownController({ shutdown: async () => { throw new Error('Active worker handle'); }, exit, forceExit, report, setExitCode, deadlineMs: 100 });
    stop();
    await jest.advanceTimersByTimeAsync(0);
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
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
    const stop = createShutdownController({ shutdown, exit: jest.fn(), forceExit: jest.fn(), report: jest.fn(), setExitCode: jest.fn() });
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

describe('uncaught exceptions', () => {
  it('reports the error and starts the graceful shutdown with exit code 1', () => {
    const source = new EventEmitter();
    const report = jest.fn(), stop = jest.fn();
    registerFatalErrorHandler(source, report, stop);
    const error = new Error('bug in a request handler');
    source.emit('uncaughtException', error);
    expect(report).toHaveBeenCalledWith(error);
    expect(stop).toHaveBeenCalledWith(1);
  });
  it('drains, closes resources and exits with code 1', async () => {
    jest.useFakeTimers();
    const source = new EventEmitter();
    const shutdown = jest.fn(async () => {});
    const exit = jest.fn(), setExitCode = jest.fn();
    const stop = createShutdownController({ shutdown, exit, forceExit: jest.fn(), report: jest.fn(), setExitCode });
    registerFatalErrorHandler(source, jest.fn(), code => stop(code));
    source.emit('uncaughtException', new Error('crash'));
    source.emit('uncaughtException', new Error('second crash while closing'));
    await jest.advanceTimersByTimeAsync(0);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(setExitCode).not.toHaveBeenCalledWith(0);
  });
  it('removes its listener when unregistered', () => {
    const source = new EventEmitter();
    const unregister = registerFatalErrorHandler(source, jest.fn(), jest.fn());
    expect(source.listenerCount('uncaughtException')).toBe(1);
    unregister();
    expect(source.listenerCount('uncaughtException')).toBe(0);
  });
});
