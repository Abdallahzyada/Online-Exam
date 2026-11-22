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
import { ensureDashboardIndexes } from './config/dashboard-indexes.js';
import { DashboardAnalyticsAdapter } from './modules/dashboard/dashboard.analytics-adapter.js';
import { MongooseDashboardRepository } from './modules/dashboard/dashboard.repository.js';
import { createCatalogRouter } from './modules/catalog/catalog.routes.js';
import { createApp } from './app.js';

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
  let server: Server | undefined;
  const monitor = new EventLoopMonitor();
  const workers = new WorkerManager({ timeoutMs: env.WORKER_TIMEOUT_MS, maxPending: env.WORKER_MAX_PENDING, report });
  // Cleanup, signals and the fatal-error handler are ready before startup opens anything,
  // so a crash or Ctrl+C during startup still closes whatever was opened so far.
  const shutdown = createShutdown({
    stopHttp: async () => { if (server) await closeServer(server); },
    stopWorkers: () => workers.close(),
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
    await ensureDashboardIndexes(database, env.ATTEMPT_COLLECTION);
    const readers = createMongoReaders(database, { users: env.USER_COLLECTION, quizzes: env.QUIZ_COLLECTION });
    const auth = createAuth(new JwtVerifier(env.JWT_SECRET), readers.sessions);
    const errors = {
      notFound: (resource: string) => new NotFoundError(resource),
      analyticsLimit: () => new AppError(422, 'ANALYTICS_LIMIT', 'Quiz exceeds the supported analytics size')
    };
    workers.start();
    monitor.start();
    const app = createApp({
      auth, trustProxy: env.TRUST_PROXY, reportError: report, corsOrigins: env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean),
      moduleRouters: [createCatalogRouter(auth)],
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
    httpServer.on('error', error => { report(error); stop(1); });
  } catch (error: unknown) {
    await shutdown().catch(report);
    throw error;
  }
}

void main().catch((error: unknown) => {
  const invalidEnvironment = error instanceof Error && error.message.startsWith('Invalid environment:');
  console.error(invalidEnvironment
    ? error.message : 'Server could not start. Check database access and configuration.');
  if (!invalidEnvironment) report(error);
  process.exitCode = 1;
});
