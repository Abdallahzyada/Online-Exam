import { Router } from 'express';
import { QuestionController } from './question.controller.js';
import type { AttemptExportSource, QuestionAuth, QuestionRepository } from './question.ports.js';
import { QuestionService } from './question.service.js';
import { validateRequest } from '../../common/middlewares/validate-request.js';
import {
  exportQuerySchema, questionParamsSchema, questionSchema, questionUpdateSchema, quizParamsSchema
} from './question.dto.js';

export function createQuestionRouter(
  repository: QuestionRepository,
  auth: QuestionAuth,
  attempts?: AttemptExportSource
): Router {
  const router = Router();
  const controller = new QuestionController(new QuestionService(repository), attempts);
  const validateQuizParams = validateRequest(quizParamsSchema, 'params', 'params');
  const validateQuestionParams = validateRequest(questionParamsSchema, 'params', 'params');
  const validateExportQuery = validateRequest(exportQuerySchema, 'query', 'query');

  router.post(
    '/admin/quizzes/:quizId/questions', auth.authenticate, auth.requireAdmin,
    validateQuizParams, validateRequest(questionSchema, 'body', 'body'), controller.create
  );
  router.patch(
    '/admin/questions/:questionId', auth.authenticate, auth.requireAdmin,
    validateQuestionParams, validateRequest(questionUpdateSchema, 'body', 'body'), controller.update
  );
  router.delete(
    '/admin/questions/:questionId', auth.authenticate, auth.requireAdmin,
    validateQuestionParams, controller.remove
  );
  router.post(
    '/admin/quizzes/:quizId/questions/import', auth.authenticate, auth.requireAdmin,
    validateQuizParams, controller.import
  );
  router.get(
    '/admin/quizzes/:quizId/questions/export', auth.authenticate, auth.requireAdmin,
    validateQuizParams, validateExportQuery, controller.exportQuestions
  );
  router.get(
    '/admin/quizzes/:quizId/attempts/export', auth.authenticate, auth.requireAdmin,
    validateQuizParams, validateExportQuery, controller.exportAttempts
  );
  return router;
}
