import { Router } from "express";
import type { DashboardAuth } from "../dashboard/dashboard.ports.js";
import { validateRequest } from "../../common/middlewares/validate-request.js";
import { quizIdSchema, updateQuizSchema } from "./quiz.dto.js";
import type { QuizController } from "./quiz.controller.js";

type CatalogAuth = Pick<DashboardAuth, "authenticate" | "requireAdmin">;

/** Mounted at /api/v1/quizzes — instructions modal for an authenticated user. */
export function createQuizRouter(auth: CatalogAuth, controller: QuizController) {
  const router = Router();

  router.get(
    "/:quizId",
    auth.authenticate,
    validateRequest(quizIdSchema.shape.params, "params"),
    controller.getQuizInstructions,
  );

  return router;
}

/** Mounted at /api/v1/admin/quizzes — admin only (analytics/questions routes live in other modules). */
export function createAdminQuizRouter(auth: CatalogAuth, controller: QuizController) {
  const router = Router();
  const adminOnly = [auth.authenticate, auth.requireAdmin];

  router.get(
    "/:quizId",
    ...adminOnly,
    validateRequest(quizIdSchema.shape.params, "params"),
    controller.getQuizAdmin,
  );
  router.patch(
    "/:quizId",
    ...adminOnly,
    validateRequest(updateQuizSchema.shape.params, "params"),
    validateRequest(updateQuizSchema.shape.body, "body"),
    controller.updateQuiz,
  );
  router.delete(
    "/:quizId",
    ...adminOnly,
    validateRequest(quizIdSchema.shape.params, "params"),
    controller.archiveQuiz,
  );

  return router;
}
