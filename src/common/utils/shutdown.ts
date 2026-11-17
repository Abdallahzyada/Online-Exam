export interface ShutdownResources {
  stopHttp(): Promise<void>;
  stopWorkers(): Promise<void>;
  closeDatabase(): Promise<void>;
  stopMonitor(): void;
}

// One shared promise makes repeated signals safe.
export function createShutdown(resources: ShutdownResources): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    closing ??= (async () => {
      const drained = await Promise.allSettled([
        Promise.resolve().then(() => resources.stopHttp()),
        Promise.resolve().then(() => resources.stopWorkers())
      ]);
      const database = await Promise.allSettled([Promise.resolve().then(() => resources.closeDatabase())]);
      resources.stopMonitor();
      const failures = [...drained, ...database].filter(result => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Shutdown did not complete cleanly');
    })();
    return closing;
  };
}
