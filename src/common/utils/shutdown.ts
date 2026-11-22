export type CleanupSetup = () => Promise<void> | void;

export class ShutdownStack {
  private readonly steps: CleanupSetup[] = [];
  private stopping: Promise<void> | undefined;

  add(step: CleanupSetup): void {
    this.steps.push(step);
  }

  stop(): Promise<void> {
    this.stopping ??= (async () => {
      const failures: unknown[] = [];
      for (const step of [...this.steps].reverse()) {
        try {
          await step();
        } catch (error: unknown) {
          failures.push(error);
        }
      }

      if (failures.length)
        throw new AggregateError(failures, "Shutdown didn't complete cleanly");
    })();
    return this.stopping;
  }
}
