export interface ShutdownControllerOptions {
  readonly shutdown: () => Promise<void>;
  readonly forceExit: () => void;
  readonly setExitCode: (code: number) => void;
  readonly report: (error: unknown) => void;
  readonly deadlineMs?: number;
}

export function createShutdownController(options: ShutdownControllerOptions) {
  let closing = false;
  return (exitCode = 0): void => {
    if (closing) return;
    closing = true;
    // Do not keep a healthy process alive; still guard leaked resource handles.
    const deadline = setTimeout(() => options.forceExit(), options.deadlineMs ?? 10_000);
    deadline.unref();
    void Promise.resolve().then(options.shutdown).then(() => {
      options.setExitCode(exitCode);
    }).catch((error: unknown) => {
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
