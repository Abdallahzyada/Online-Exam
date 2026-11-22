import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Connection } from 'mongoose';
import { parseEnvironment } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { createMongoReaders } from './config/dashboard-adapters.js';
import { createAuth, JwtVerifier } from './common/middlewares/auth-jwt.js';
import { AppError, NotFoundError } from './common/errors/app-error.js';
import { describeError } from './common/errors/error-report.js';
import { WorkerManager } from './common/workers/worker-manager.js';
import { EventLoopMonitor } from './common/telemetry/event-loop-monitor.js';
import { createShutdown } from './common/utils/shutdown.js';
import { createShutdownController, registerFatalErrorHandler, registerShutdownSignals } from './common/utils/shutdown-controller.js';
import { SmtpEmailSender } from './common/utils/smtp-email-sender.js';
import { ensureDashboardIndexes } from './config/dashboard-indexes.js';
import { DashboardAnalyticsAdapter } from './modules/dashboard/dashboard.analytics-adapter.js';
import { MongooseDashboardRepository } from './modules/dashboard/dashboard.repository.js';
import { createCatalogRouter } from './modules/catalog/catalog.routes.js';
import { createAttemptModule } from './modules/attempt/attempt.module.js';
import type { AttemptModule } from './modules/attempt/attempt.module.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { AuthEmailAdapter } from './modules/auth/auth-email.adapter.js';
import { createQuestionModel } from './modules/question/question.model.js';
import { createQuestionRouter } from './modules/question/question.routes.js';
import { MongooseQuestionRepository } from './modules/question/question.repository.js';
import { createAttemptExportSource } from './modules/question/question.attempt-adapter.js';
import { createApp } from './app.js';

// Logs never include tokens, request bodies, error messages or database connection strings.
const report = (error: unknown) => { console.error(describeError(error)); };

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
}

async function main(): Promise<void> {
  const env = parseEnvironment(process.env);
  let connection: Connection | undefined;
  let attempts: AttemptModule | undefined;
  let server: Server | undefined;
  const monitor = new EventLoopMonitor();
  const workers = new WorkerManager({ timeoutMs: env.WORKER_TIMEOUT_MS, maxPending: env.WORKER_MAX_PENDING, report });
  // Cleanup, signals and the fatal-error handler are ready before startup opens anything,
  // so a crash or Ctrl+C during startup still closes whatever was opened so far.
  const shutdown = createShutdown({
    stopHttp: async () => { if (server) await closeServer(server); },
    // The attempt expiry job finishes its current sweep before the worker and MongoDB close.
    stopWorkers: async () => { try { await attempts?.stop(); } finally { await workers.close(); } },
    closeDatabase: async () => { if (connection) await disconnectDatabase(connection); },
    stopMonitor: () => monitor.stop()
  });
  const stop = createShutdownController({
    shutdown, report,
    exit: code => process.exit(code),
    forceExit: () => { server?.closeAllConnections(); process.exit(1); },
    setExitCode: code => { process.exitCode = code; }
  });
  registerFatalErrorHandler(process, error => {
    console.error('Uncaught exception. Shutting down gracefully.');
    report(error);
  }, code => stop(code));
  registerShutdownSignals(process, () => stop());
  try {
    connection = await connectDatabase(env.MONGO_URI, env.NODE_ENV === 'production');
    const database = connection;
    const smtpEmailSender = new SmtpEmailSender({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
      user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM
    });
    if (env.NODE_ENV === 'production') await smtpEmailSender.verify();
    await ensureDashboardIndexes(database, env.ATTEMPT_COLLECTION);
    const readers = createMongoReaders(database, { users: env.USER_COLLECTION, quizzes: env.QUIZ_COLLECTION });
    const questionModel = createQuestionModel(database);
    const auth = createAuth(new JwtVerifier(env.JWT_SECRET), readers.sessions);
    const attemptModule = createAttemptModule({
      connection: database, auth, report,
      collections: { attempts: env.ATTEMPT_COLLECTION, quizzes: env.QUIZ_COLLECTION }
    });
    attempts = attemptModule;
    await attemptModule.ensureIndexes();
    const errors = {
      notFound: (resource: string) => new NotFoundError(resource),
      analyticsLimit: () => new AppError(422, 'ANALYTICS_LIMIT', 'Quiz exceeds the supported analytics size')
    };
    workers.start();
    monitor.start();
    const app = createApp({
      auth, trustProxy: env.TRUST_PROXY, reportError: report,
      corsOrigins: env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean),
      moduleRouters: [
        createCatalogRouter(auth),
        createQuestionRouter(
          new MongooseQuestionRepository({ connection: database, questions: questionModel, quizCollection: env.QUIZ_COLLECTION }),
          auth,
          createAttemptExportSource(database)
        ),
        attemptModule.router,
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
        profiles: readers.profiles, quizzes: readers.quizzes, errors,
        repository: new MongooseDashboardRepository({ connection: database, attemptCollection: env.ATTEMPT_COLLECTION, errors }),
        analytics: new DashboardAnalyticsAdapter(workers)
      },
      health: { dbReady: () => database.readyState === 1, workerReady: () => workers.isReady(), eventLoop: monitor, uptime: () => process.uptime() }
    });
    const httpServer = createServer(app);
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(env.PORT, () => { httpServer.off('error', reject); resolve(); });
    });
    server = httpServer;
    console.log(`Server listening on port ${env.PORT}`);
    attemptModule.startBackgroundJobs();
    httpServer.on('error', error => { report(error); stop(1); });
  } catch (error: unknown) {
    await shutdown().catch(report);
    throw error;
  }
}

void main().catch((error: unknown) => {
  // Environment validation messages contain field names, never their values.
  const invalidEnvironment = error instanceof Error && error.message.startsWith('Invalid environment:');
  console.error(invalidEnvironment
    ? error.message : 'Server could not start. Check database access and configuration.');
  if (!invalidEnvironment) report(error);
  process.exitCode = 1;
});
