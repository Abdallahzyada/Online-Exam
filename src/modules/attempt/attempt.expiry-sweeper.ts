import type { AttemptRepository } from './attempt.ports.js';

export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export interface ExpirySweeperOptions {
  readonly repository: Pick<AttemptRepository, 'expireOverdue'>;
  readonly now: () => Date;
  readonly report: (error: unknown) => void;
  readonly intervalMs?: number;
}
export interface ExpirySweeper {
  sweep(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

// Abandoned attempts would otherwise stay IN_PROGRESS forever and never reach history.
// One sweep runs at a time; the timer does not keep the process alive.
export function createExpirySweeper(options: ExpirySweeperOptions): ExpirySweeper {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  const sweep = (): Promise<void> => {
    running ??= options.repository.expireOverdue(options.now())
      .then(() => undefined, (error: unknown) => { options.report(error); })
      .finally(() => { running = undefined; });
    return running;
  };
  return {
    sweep,
    start() {
      if (timer) return;
      timer = setInterval(() => { void sweep(); }, options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await running;
    }
  };
}
