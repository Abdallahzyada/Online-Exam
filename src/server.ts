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
import { createShutdownController, registerFatalErrorHandler, registerShutdownSignals } from './common/utils/shutdown-controller.js';
import { ensureDashboardIndexes } from './config/dashboard-indexes.js';
import { DashboardAnalyticsAdapter } from './modules/dashboard/dashboard.analytics-adapter.js';
import { MongooseDashboardRepository } from './modules/dashboard/dashboard.repository.js';
import { createCatalogRouter } from './modules/catalog/catalog.routes.js';
import { createApp } from './app.js';
import { createQuestionModel } from './modules/question/question.model.js';
import { createQuestionRouter } from './modules/question/question.routes.js';
import { MongooseQuestionRepository } from './modules/question/question.repository.js';
import { createAttemptExportSource } from './modules/question/question.attempt-adapter.js';

async function main(): Promise<void> {
  const env = parseEnvironment(process.env);
  const report = (error: unknown) => {
    console.error(error instanceof AppError ? error.code : 'Unexpected runtime failure');
  };
  let connection: Connection | undefined;
  const monitor = new EventLoopMonitor();
  const workers = new WorkerManager({ timeoutMs: env.WORKER_TIMEOUT_MS, maxPending: env.WORKER_MAX_PENDING, report });
  try {
    connection = await connectDatabase(env.MONGO_URI, env.NODE_ENV === 'production');
    const database = connection;
    await ensureDashboardIndexes(database, env.ATTEMPT_COLLECTION);
    const readers = createMongoReaders(database, { users: env.USER_COLLECTION, quizzes: env.QUIZ_COLLECTION });
    const questionModel = createQuestionModel(database);
    const auth = createAuth(new JwtVerifier(env.JWT_SECRET), readers.sessions);
    const errors = {
      notFound: (resource: string) => new NotFoundError(resource),
      analyticsLimit: () => new AppError(422, 'ANALYTICS_LIMIT', 'Quiz exceeds the supported analytics size')
    };
    workers.start();
    monitor.start();
    const app = createApp({
  auth, trustProxy: env.TRUST_PROXY, reportError: report, corsOrigins: env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean),
  moduleRouters: [
    createCatalogRouter(auth),
    createQuestionRouter(
      new MongooseQuestionRepository({ connection: database, questions: questionModel, quizCollection: env.QUIZ_COLLECTION }),
      auth,
      createAttemptExportSource(database)
    )
  ],
  dashboard: {
    profiles: readers.profiles, quizzes: readers.quizzes, errors,
    repository: new MongooseDashboardRepository({ connection: database, attemptCollection: env.ATTEMPT_COLLECTION, errors }),
    analytics: new DashboardAnalyticsAdapter(workers)
  },
  health: { dbReady: () => database.readyState === 1, workerReady: () => workers.isReady(), eventLoop: monitor, uptime: () => process.uptime() }
});
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.PORT, () => { server.off('error', reject); resolve(); });
    });
    console.log(`Server listening on port ${env.PORT}`);
    const shutdown = createShutdown({
      stopHttp: () => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeIdleConnections();
      }),
      stopWorkers: () => workers.close(), closeDatabase: () => disconnectDatabase(database),
      stopMonitor: () => monitor.stop()
    });
    const stop = createShutdownController({
      shutdown, report,
      exit: code => process.exit(code),
      forceExit: () => { server.closeAllConnections(); process.exit(1); },
      setExitCode: code => { process.exitCode = code; }
    });
    registerShutdownSignals(process, () => stop());
    registerFatalErrorHandler(process, error => {
      console.error('Uncaught exception. Shutting down gracefully.');
      report(error);
    }, code => stop(code));
    server.on('error', error => { report(error); stop(1); });
  } catch (error: unknown) {
    await workers.close();
    monitor.stop();
    if (connection) await disconnectDatabase(connection);
    throw error;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error && error.message.startsWith('Invalid environment:')
    ? error.message : 'Server could not start. Check database access and configuration.';
  console.error(message);
  process.exitCode = 1;
});
