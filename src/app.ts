import express from 'express';
import type { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createErrorHandler } from './common/middlewares/global-error-handler.js';
import { NotFoundError } from './common/errors/app-error.js';
import { createHealthRouter } from './common/telemetry/health.routes.js';
import type { HealthDependencies } from './common/telemetry/health.routes.js';

export interface ApplicationDependencies {
  readonly health: HealthDependencies;
  readonly corsOrigins: readonly string[];
  readonly reportError: (error: unknown) => void;
  readonly moduleRouters?: readonly Router[];
  readonly trustProxy?: false | readonly string[];
}

export function createApp(dependencies: ApplicationDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', dependencies.trustProxy ? [...dependencies.trustProxy] : false);
  app.use(helmet());
  app.use(cors({ origin: [...dependencies.corsOrigins] }));
  app.use('/api/v1', createHealthRouter(dependencies.health));
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => { res.status(429).json({ success: false, error: {
      code: 'RATE_LIMITED', message: 'Too many requests. Try again later.', details: []
    } }); }
  }));
  app.use(express.json({ limit: '100kb' }));
  for (const router of dependencies.moduleRouters ?? []) app.use('/api/v1', router);
  app.use((_req, _res, next) => next(new NotFoundError('Route')));
  app.use(createErrorHandler(dependencies.reportError));
  return app;
}
