import { Router } from 'express';
import { AttemptController } from './attempt.controller.js';
import type { AttemptAuth } from './attempt.ports.js';
import type { AttemptService } from './attempt.service.js';
import { validateAttemptParams, validateEmptyQuery, validateQuizParams, validateSubmission } from './attempt.validation.js';

// Mounted under /api/v1 through createApp's moduleRouters. All routes are student-only.
export function createAttemptRouter(service: AttemptService, auth: AttemptAuth): Router {
  const router = Router();
  const controller = new AttemptController(service, auth);
  const student = [auth.authenticate, auth.requireStudent];

  router.post('/quizzes/:quizId/attempts', ...student, validateQuizParams, validateEmptyQuery, controller.start);
  router.post('/attempts/:attemptId/submit', ...student, validateAttemptParams, validateEmptyQuery, validateSubmission, controller.submit);
  router.get('/attempts/:attemptId/review', ...student, validateAttemptParams, validateEmptyQuery, controller.review);
  return router;
}
