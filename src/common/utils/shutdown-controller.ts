export interface ShutdownControllerOptions {
  readonly shutdown: () => Promise<void>;
  /** Called once cleanup succeeds, so a leftover timer or socket cannot keep the process alive. */
  readonly exit: (code: number) => void;
  readonly forceExit: () => void;
  readonly setExitCode: (code: number) => void;
  readonly report: (error: unknown) => void;
  readonly deadlineMs?: number;
}

export function createShutdownController(options: ShutdownControllerOptions) {
  let closing = false;
  let finalExitCode = 0;
  return (exitCode = 0): void => {
    if (exitCode !== 0) finalExitCode = exitCode;
    if (closing) { options.setExitCode(finalExitCode); return; }
    closing = true;
    // Keep the deadline for failed or hanging cleanup only.
    const deadline = setTimeout(() => options.forceExit(), options.deadlineMs ?? 10_000);
    deadline.unref();
    void Promise.resolve().then(options.shutdown).then(() => {
      clearTimeout(deadline);
      options.setExitCode(finalExitCode);
      options.exit(finalExitCode);
    }).catch((error: unknown) => {
      finalExitCode = 1;
      options.setExitCode(1);
      options.report(error);
    });
  };
}

interface SignalSource {
  on(signal: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
  off(signal: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
}
export function registerShutdownSignals(source: SignalSource, stop: () => void): () => void {
  source.on('SIGINT', stop);
  source.on('SIGTERM', stop);
  return () => { source.off('SIGINT', stop); source.off('SIGTERM', stop); };
}

interface FatalErrorSource {
  on(event: 'uncaughtException', handler: (error: unknown) => void): unknown;
  off(event: 'uncaughtException', handler: (error: unknown) => void): unknown;
}
// Session 2: an uncaught exception still drains requests and closes the worker
// and database, then exits with code 1. Unhandled promise rejections arrive here
// too, because Node raises them as uncaught exceptions by default.
export function registerFatalErrorHandler(
  source: FatalErrorSource, report: (error: unknown) => void, stop: (exitCode: number) => void
): () => void {
  const handler = (error: unknown) => { report(error); stop(1); };
  source.on('uncaughtException', handler);
  return () => { source.off('uncaughtException', handler); };
}
