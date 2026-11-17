import { Router } from 'express';
import { success } from '../utils/response-envelope.js';

export interface HealthDependencies {
  readonly dbReady: () => boolean;
  readonly workerReady: () => boolean;
  readonly eventLoop: { snapshot(): { meanDelayMs: number; maxDelayMs: number; p99DelayMs: number } };
  readonly uptime: () => number;
}

export function createHealthRouter(dependencies: HealthDependencies): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    const databaseReady = dependencies.dbReady();
    const workerReady = dependencies.workerReady();
    const ready = databaseReady && workerReady;
    res.status(ready ? 200 : 503).json(success({
      status: ready ? 'ok' : 'degraded', uptimeSeconds: dependencies.uptime(),
      dbStatus: databaseReady ? 'connected' : 'disconnected',
      workerStatus: workerReady ? 'ready' : 'unavailable',
      eventLoop: dependencies.eventLoop.snapshot()
    }));
  });
  return router;
}
