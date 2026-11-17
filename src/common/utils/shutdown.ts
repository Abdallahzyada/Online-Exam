export interface ShutdownResources {
  stopHttp(): Promise<void>;
  stopWorkers(): Promise<void>;
  closeDatabase(): Promise<void>;
  stopMonitor(): void;
}

// Drain admitted HTTP requests while workers and MongoDB are still available.
export function createShutdown(resources: ShutdownResources): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    closing ??= (async () => {
      const failures: unknown[] = [];
      for (const close of [
        () => resources.stopHttp(), () => resources.stopWorkers(),
        () => resources.closeDatabase(), () => resources.stopMonitor()
      ]) {
        try { await close(); } catch (error: unknown) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Shutdown did not complete cleanly');
    })();
    return closing;
  };
}
