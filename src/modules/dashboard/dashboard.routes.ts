import { Router } from 'express';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import type { DashboardDependencies } from './dashboard.service.js';
import type { DashboardAuth } from './dashboard.ports.js';
import { validateAnalyticsRequest, validateDashboardQuery, validateHistoryQuery } from './dashboard.validation.js';

export function createDashboardRouter(dependencies: DashboardDependencies, auth: DashboardAuth): Router {
  const router = Router();
  const controller = new DashboardController(new DashboardService(dependencies), auth);

  router.get('/dashboard/me', auth.authenticate, auth.requireStudent, validateDashboardQuery, controller.getDashboard);
  router.get('/dashboard/history', auth.authenticate, auth.requireStudent, validateHistoryQuery, controller.getHistory);
  router.get('/admin/quizzes/:quizId/analytics', auth.authenticate, auth.requireAdmin, validateAnalyticsRequest, controller.getAnalytics);
  return router;
}
