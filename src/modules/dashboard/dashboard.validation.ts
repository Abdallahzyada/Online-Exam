import type { RequestHandler } from 'express';
import { analyticsParamsSchema, emptyQuerySchema, historyQuerySchema } from './dashboard.dto.js';
import type { HistoryQuery } from './dashboard.dto.js';
import { validateRequest } from '../../common/middlewares/validate-request.js';

export interface DashboardLocals {
  historyQuery?: HistoryQuery;
  quizId?: string;
}

export const validateDashboardQuery = validateRequest(emptyQuerySchema, 'query');

export const validateHistoryQuery = validateRequest(historyQuerySchema, 'query', 'historyQuery');

export const validateAnalyticsRequest: RequestHandler = (req, res, next) => {
  const params = analyticsParamsSchema.safeParse(req.params);
  const query = emptyQuerySchema.safeParse(req.query);
  if (!params.success) { next(params.error); return; }
  if (!query.success) { next(query.error); return; }
  res.locals.quizId = params.data.quizId;
  next();
};
