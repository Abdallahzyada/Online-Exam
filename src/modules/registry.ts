import type { Router } from 'express';
import type { Connection } from 'mongoose';
import type { Environment } from '../config/env.js';
import { createMongoReaders } from '../config/dashboard-adapters.js';
import { ensureDashboardIndexes } from '../config/dashboard-indexes.js';
import { AppError, NotFoundError } from '../common/errors/app-error.js';
import type { createAuth } from '../common/middlewares/auth-jwt.js';
import type { WorkerManager } from '../common/workers/worker-manager.js';
import type { EmailSender } from '../common/utils/email-sender.js';
import { createAuthRouter } from './auth/auth.routes.js';
import { AuthEmailAdapter } from './auth/auth-email.adapter.js';
import { createCatalogRouter } from './catalog/catalog.routes.js';
import { createQuestionModel } from './question/question.model.js';
import { MongooseQuestionRepository } from './question/question.repository.js';
import { createQuestionRouter } from './question/question.routes.js';
import { createAttemptExportSource } from './question/question.attempt-adapter.js';
import { createAttemptModule } from './attempt/attempt.module.js';
import { createDashboardRouter } from './dashboard/dashboard.routes.js';
import { MongooseDashboardRepository } from './dashboard/dashboard.repository.js';
import { DashboardAnalyticsAdapter } from './dashboard/dashboard.analytics-adapter.js';

export interface FeatureModule {
  readonly name: string;
  readonly router: Router;
  readonly ensureIndexes?: () => Promise<void>;
  readonly startJobs?: () => void;
  readonly stopJobs?: () => Promise<void>;
}

export interface ModuleContext {
  readonly env: Environment;
  readonly connection: Connection;
  readonly auth: ReturnType<typeof createAuth>;
  readonly workers: WorkerManager;
  readonly emailSender: EmailSender;
  readonly report: (error: unknown) => void;
}

export function createFeatureModules({ env, connection, auth, workers, emailSender, report }: ModuleContext): FeatureModule[] {
  const readers = createMongoReaders(connection, { users: env.USER_COLLECTION, quizzes: env.QUIZ_COLLECTION });
  const errors = {
    notFound: (resource: string) => new NotFoundError(resource),
    analyticsLimit: () => new AppError(422, 'ANALYTICS_LIMIT', 'Quiz exceeds the supported analytics size')
  };
  const attempts = createAttemptModule({
    connection, auth, report,
    collections: { attempts: env.ATTEMPT_COLLECTION, quizzes: env.QUIZ_COLLECTION }
  });
  const questions = new MongooseQuestionRepository({
    connection, questions: createQuestionModel(connection), quizCollection: env.QUIZ_COLLECTION
  });

  return [
    {
      name: 'auth',
      router: createAuthRouter({
        connection, collectionName: env.USER_COLLECTION, auth, reportError: report,
        jwtSecret: env.JWT_SECRET, jwtExpiresIn: env.JWT_EXPIRES_IN, otpExpiresMinutes: env.OTP_EXPIRES_MINUTES,
        authTokenSecret: env.AUTH_TOKEN_SECRET,
        emailSender: new AuthEmailAdapter(emailSender)
      })
    },
    { name: 'catalog', router: createCatalogRouter(auth) },
    { name: 'questions', router: createQuestionRouter(questions, auth, createAttemptExportSource(connection)) },
    {
      name: 'attempts', router: attempts.router,
      ensureIndexes: () => attempts.ensureIndexes(),
      startJobs: () => attempts.startBackgroundJobs(),
      stopJobs: () => attempts.stop()
    },
    {
      name: 'dashboard',
      router: createDashboardRouter({
        profiles: readers.profiles, quizzes: readers.quizzes, errors,
        repository: new MongooseDashboardRepository({ connection, attemptCollection: env.ATTEMPT_COLLECTION, errors }),
        analytics: new DashboardAnalyticsAdapter(workers)
      }, auth),
      ensureIndexes: () => ensureDashboardIndexes(connection, env.ATTEMPT_COLLECTION)
    }
  ];
}