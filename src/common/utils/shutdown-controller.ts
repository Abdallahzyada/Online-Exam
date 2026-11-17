export interface ShutdownControllerOptions {
  readonly shutdown: () => Promise<void>;
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
