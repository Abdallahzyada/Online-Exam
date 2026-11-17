import type { Request, Response, NextFunction } from 'express';
import type { DashboardAuth } from './dashboard.ports.js';
import type { DashboardLocals } from './dashboard.validation.js';
import type { DashboardService } from './dashboard.service.js';
import { success, paginated } from '../../common/utils/response-envelope.js';

type DashboardHttpResponse = Response<unknown, DashboardLocals>;

export class DashboardController {
  constructor(private readonly service: DashboardService, private readonly auth: DashboardAuth) {}

  getDashboard = async (req: Request, res: DashboardHttpResponse, next: NextFunction): Promise<void> => {
    try {
      const dashboard = await this.service.getDashboard(this.auth.studentId(req));
      res.status(200).json(success(dashboard));
    } catch (error: unknown) { next(error); }
  };

  getHistory = async (req: Request, res: DashboardHttpResponse, next: NextFunction): Promise<void> => {
    try {
      const query = res.locals.historyQuery;
      if (!query) throw new Error('History validation middleware is missing');
      const history = await this.service.getHistory(this.auth.studentId(req), query);
      res.status(200).json(paginated(history.entries, history.meta));
    } catch (error: unknown) { next(error); }
  };

  getAnalytics = async (_req: Request, res: DashboardHttpResponse, next: NextFunction): Promise<void> => {
    try {
      const quizId = res.locals.quizId;
      if (!quizId) throw new Error('Analytics validation middleware is missing');
      const analytics = await this.service.getAnalytics(quizId);
      res.status(200).json(success(analytics));
    } catch (error: unknown) { next(error); }
  };
}
