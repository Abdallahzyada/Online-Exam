import { createServer } from 'node:http';
import type { Connection } from 'mongoose';
import { parseEnvironment } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { createMongoReaders } from './config/dashboard-adapters.js';
import { createAuth, JwtVerifier } from './common/middlewares/auth-jwt.js';
import { AppError, NotFoundError } from './common/errors/app-error.js';
import { WorkerManager } from './common/workers/worker-manager.js';
import { EventLoopMonitor } from './common/telemetry/event-loop-monitor.js';
import { createShutdown } from './common/utils/shutdown.js';
import { createShutdownController, registerShutdownSignals } from './common/utils/shutdown-controller.js';
import { ensureDashboardIndexes } from './config/dashboard-indexes.js';
import { DashboardAnalyticsAdapter } from './modules/dashboard/dashboard.analytics-adapter.js';
import { MongooseDashboardRepository } from './modules/dashboard/dashboard.repository.js';
import { createCatalogRouter } from './modules/catalog/catalog.routes.js';
import { createAttemptModule } from './modules/attempt/attempt.module.js';
import type { AttemptModule } from './modules/attempt/attempt.module.js';
import { createApp } from './app.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { SmtpEmailSender } from './common/utils/smtp-email-sender.js';
import { AuthEmailAdapter } from './modules/auth/auth-email.adapter.js';
import { createQuestionModel } from './modules/question/question.model.js';
import { createQuestionRouter } from './modules/question/question.routes.js';
import { MongooseQuestionRepository } from './modules/question/question.repository.js';
import { createAttemptExportSource } from './modules/question/question.attempt-adapter.js';
async function main(): Promise<void> {
  const env = parseEnvironment(process.env);
  const report = (error: unknown) => {
    // Do not log tokens, request bodies, or database connection strings.
    console.error(error instanceof AppError ? error.code : 'Unexpected runtime failure');
  };
  let connection: Connection | undefined;
  let attempts: AttemptModule | undefined;
  const monitor = new EventLoopMonitor();
  const workers = new WorkerManager({ timeoutMs: env.WORKER_TIMEOUT_MS, maxPending: env.WORKER_MAX_PENDING, report });
  try {
    connection = await connectDatabase(env.MONGO_URI, env.NODE_ENV === 'production');
    const smtpEmailSender = new SmtpEmailSender({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  user: env.SMTP_USER,
  pass: env.SMTP_PASS,
  from: env.SMTP_FROM
});

if (env.NODE_ENV === 'production') {
  await smtpEmailSender.verify();
}
    const database = connection;
    await ensureDashboardIndexes(database, env.ATTEMPT_COLLECTION);
    const readers = createMongoReaders(database, { users: env.USER_COLLECTION, quizzes: env.QUIZ_COLLECTION });
    const questionModel = createQuestionModel(database);
    const auth = createAuth(new JwtVerifier(env.JWT_SECRET), readers.sessions);
    attempts = createAttemptModule({
      connection: database, auth, report,
      collections: { attempts: env.ATTEMPT_COLLECTION, quizzes: env.QUIZ_COLLECTION }
    });
    await attempts.ensureIndexes();
    const errors = {
      notFound: (resource: string) => new NotFoundError(resource),
      analyticsLimit: () => new AppError(422, 'ANALYTICS_LIMIT', 'Quiz exceeds the supported analytics size')
    };
    workers.start();
    monitor.start();
const app = createApp({
  auth,
  trustProxy: env.TRUST_PROXY,
  reportError: report,
  corsOrigins: env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean),

  moduleRouters: [
    createCatalogRouter(auth),

    createQuestionRouter(
      new MongooseQuestionRepository({
        connection: database,
        questions: questionModel,
        quizCollection: env.QUIZ_COLLECTION
      }),
      auth,
      createAttemptExportSource(database)
    ),

    attempts.router,

    createAuthRouter({
      connection: database,
      collectionName: env.USER_COLLECTION,
      authTokenSecret: env.AUTH_TOKEN_SECRET,
      auth,
      jwtSecret: env.JWT_SECRET,
      jwtExpiresIn: env.JWT_EXPIRES_IN,
      otpExpiresMinutes: env.OTP_EXPIRES_MINUTES,
      reportError: report,
      emailSender: new AuthEmailAdapter(smtpEmailSender)
    })
  ],

  dashboard: {
    profiles: readers.profiles,
    quizzes: readers.quizzes,
    errors,
    repository: new MongooseDashboardRepository({
      connection: database,
      attemptCollection: env.ATTEMPT_COLLECTION,
      errors
    }),
    analytics: new DashboardAnalyticsAdapter(workers)
  },

  health: {
    dbReady: () => database.readyState === 1,
    workerReady: () => workers.isReady(),
    eventLoop: monitor,
    uptime: () => process.uptime()
  }
});
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.PORT, () => { server.off('error', reject); resolve(); });
    });
    console.log(`Server listening on port ${env.PORT}`);
    attempts.startBackgroundJobs();
    const attemptModule = attempts;
    const shutdown = createShutdown({
      stopHttp: () => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeIdleConnections();
      }),
      // The attempt expiry job finishes its current sweep before MongoDB closes.
      stopWorkers: async () => { await attemptModule.stop(); await workers.close(); },
      closeDatabase: () => disconnectDatabase(database),
      stopMonitor: () => monitor.stop()
    });
    const stop = createShutdownController({
      shutdown, report,
      forceExit: () => { server.closeAllConnections(); process.exit(1); },
      setExitCode: code => { process.exitCode = code; }
    });
    registerShutdownSignals(process, () => stop());
    server.on('error', error => { report(error); stop(1); });
  } catch (error: unknown) {
    await attempts?.stop();
    await workers.close();
    monitor.stop();
    if (connection) await disconnectDatabase(connection);
    throw error;
  }
}

void main().catch((error: unknown) => {
  // Environment validation messages contain field names, never their values.
  const message = error instanceof Error && error.message.startsWith('Invalid environment:')
    ? error.message : 'Server could not start. Check database access and configuration.';
  console.error(message);
  process.exitCode = 1;
});
