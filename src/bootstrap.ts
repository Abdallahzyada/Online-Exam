import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Environment } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { createMongoReaders } from './config/dashboard-adapters.js';
import { createAuth, JwtVerifier } from './common/middlewares/auth-jwt.js';
import { WorkerManager } from './common/workers/worker-manager.js';
import { EventLoopMonitor } from './common/telemetry/event-loop-monitor.js';
import { SmtpEmailSender } from './common/utils/smtp-email-sender.js';
import type { ShutdownStack } from './common/utils/shutdown.js';
import { createFeatureModules } from './modules/registry.js';
import { createApp } from './app.js';

/**
 * Opens shared resources, wires every feature module and starts listening.
 * Each resource registers its cleanup on `shutdown` as soon as it opens, so the
 * stack closes them newest-first: HTTP, module jobs, monitor, worker, MongoDB.
 * The caller owns `shutdown` and can run it while startup is still in progress.
 */
export async function startApplication(
  env: Environment, report: (error: unknown) => void, shutdown: ShutdownStack
): Promise<Server> {
  try {
    const connection = await connectDatabase(env.MONGO_URI, env.NODE_ENV === 'production');
    shutdown.add(() => disconnectDatabase(connection));

    const emailSender = new SmtpEmailSender({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
      user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM
    });
    if (env.NODE_ENV === 'production') await emailSender.verify();

    const workers = new WorkerManager({ timeoutMs: env.WORKER_TIMEOUT_MS, maxPending: env.WORKER_MAX_PENDING, report });
    shutdown.add(() => workers.close());
    workers.start();

    const monitor = new EventLoopMonitor();
    shutdown.add(() => monitor.stop());
    monitor.start();

    const readers = createMongoReaders(connection, { users: env.USER_COLLECTION, quizzes: env.QUIZ_COLLECTION });
    const auth = createAuth(new JwtVerifier(env.JWT_SECRET), readers.sessions);
    const features = createFeatureModules({ env, connection, auth, workers, emailSender, report });
    for (const feature of features) await feature.ensureIndexes?.();
    for (const feature of features) {
      if (feature.stopJobs) shutdown.add(feature.stopJobs);
      feature.startJobs?.();
    }

    const app = createApp({
      trustProxy: env.TRUST_PROXY, reportError: report,
      corsOrigins: env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean),
      moduleRouters: features.map(feature => feature.router),
      health: {
        dbReady: () => connection.readyState === 1, workerReady: () => workers.isReady(),
        eventLoop: monitor, uptime: () => process.uptime()
      }
    });
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.PORT, () => { server.off('error', reject); resolve(); });
    });
    shutdown.add(() => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections();
    }));
    return server;
  } catch (error: unknown) {
    await shutdown.stop().catch(report);
    throw error;
  }
}
