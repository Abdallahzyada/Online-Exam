import { Router } from "express";
import type { DashboardAuth } from "../dashboard/dashboard.ports.js";
import { validateRequest } from "../../common/middlewares/validate-request.js";
import {
  createQuizSchema,
  diplomaQuizzesSchema,
  publishQuizSchema,
  quizIdSchema,
  updateQuizSchema,
} from "./quiz.dto.js";
import * as controller from "./quiz.controller.js";

export function createQuizRouter(auth: Pick<DashboardAuth, "authenticate" | "requireAdmin">) {
  const router = Router();

  router.use(auth.authenticate);

  router.get(
    "/diploma/:diplomaId",
    validateRequest(diplomaQuizzesSchema.shape.params, "params"),
    validateRequest(diplomaQuizzesSchema.shape.query, "query"),
    controller.listDiplomaQuizzes,
  );
  router.get(
    "/:quizId",
    validateRequest(quizIdSchema.shape.params, "params"),
    controller.getQuizInstructions,
  );

  router.post(
    "/diploma/:diplomaId",
    auth.requireAdmin,
    validateRequest(createQuizSchema.shape.params, "params"),
    validateRequest(createQuizSchema.shape.body, "body"),
    controller.createQuiz,
  );
  router.patch(
    "/:quizId",
    auth.requireAdmin,
    validateRequest(updateQuizSchema.shape.params, "params"),
    validateRequest(updateQuizSchema.shape.body, "body"),
    controller.updateQuiz,
  );
  router.patch(
    "/:quizId/publish",
    auth.requireAdmin,
    validateRequest(publishQuizSchema.shape.params, "params"),
    validateRequest(publishQuizSchema.shape.body, "body"),
    controller.publishQuiz,
  );
  router.delete(
    "/:quizId",
    auth.requireAdmin,
    validateRequest(quizIdSchema.shape.params, "params"),
    controller.archiveQuiz,
  );
  router.get(
    "/:quizId/admin",
    auth.requireAdmin,
    validateRequest(quizIdSchema.shape.params, "params"),
    controller.getQuizAdmin,
  );

  return router;
}
