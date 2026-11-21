import type { Router } from 'express';
import type { Connection } from 'mongoose';
import { createAttemptCatalogReaders } from './attempt.catalog-adapter.js';
import { createExpirySweeper } from './attempt.expiry-sweeper.js';
import { getAttemptModel } from './attempt.model.js';
import type { AttemptAuth } from './attempt.ports.js';
import { MongooseAttemptRepository } from './attempt.repository.js';
import { createAttemptRouter } from './attempt.routes.js';
import { AttemptService } from './attempt.service.js';

export interface AttemptModuleOptions {
  readonly connection: Connection;
  readonly auth: AttemptAuth;
  readonly collections: { readonly attempts: string; readonly quizzes: string; readonly questions?: string };
  readonly report: (error: unknown) => void;
  readonly now?: () => Date;
  readonly sweepIntervalMs?: number;
}
export interface AttemptModule {
  readonly router: Router;
  ensureIndexes(): Promise<void>;
  startBackgroundJobs(): void;
  stop(): Promise<void>;
}

// Single entry point for the bootstrap. See docs/attempt-contract.md for wiring.
export function createAttemptModule(options: AttemptModuleOptions): AttemptModule {
  const now = options.now ?? (() => new Date());
  const model = getAttemptModel(options.connection, options.collections.attempts);
  const repository = new MongooseAttemptRepository(model);
  const readers = createAttemptCatalogReaders(options.connection, {
    quizzes: options.collections.quizzes, questions: options.collections.questions ?? 'questions'
  });
  const service = new AttemptService({ repository, quizzes: readers.quizzes, questions: readers.questions, now });
  const sweeper = createExpirySweeper({
    repository, now, report: options.report,
    ...(options.sweepIntervalMs === undefined ? {} : { intervalMs: options.sweepIntervalMs })
  });
  return {
    router: createAttemptRouter(service, options.auth),
    async ensureIndexes() { await model.createIndexes(); },
    startBackgroundJobs() { sweeper.start(); void sweeper.sweep(); },
    stop: () => sweeper.stop()
  };
}
