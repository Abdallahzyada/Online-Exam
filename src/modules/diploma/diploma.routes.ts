import { Router } from "express";
import type { DashboardAuth } from "../dashboard/dashboard.ports.js";
import { validateRequest } from "../../common/middlewares/validate-request.js";
import { createQuizSchema, diplomaQuizzesSchema } from "../quiz/quiz.dto.js";
import type { QuizController } from "../quiz/quiz.controller.js";
import {
  createDiplomaSchema,
  diplomaIdSchema,
  listDiplomasSchema,
  updateDiplomaSchema,
} from "./diploma.dto.js";
import type { DiplomaController } from "./diploma.controller.js";

type CatalogAuth = Pick<DashboardAuth, "authenticate" | "requireAdmin">;

/** Mounted at /api/v1/diplomas — any authenticated user (students see active diplomas / published quizzes). */
export function createDiplomaRouter(auth: CatalogAuth, controller: DiplomaController) {
  const router = Router();

  router.get(
    "/",
    auth.authenticate,
    validateRequest(listDiplomasSchema.shape.query, "query"),
    controller.listDiplomas,
  );
  router.get(
    "/:diplomaId",
    auth.authenticate,
    validateRequest(diplomaIdSchema.shape.params, "params"),
    controller.getDiploma,
  );
  router.get(
    "/:diplomaId/quizzes",
    auth.authenticate,
    validateRequest(diplomaQuizzesSchema.shape.params, "params"),
    validateRequest(diplomaQuizzesSchema.shape.query, "query"),
    controller.listDiplomaQuizzes,
  );

  return router;
}

/** Mounted at /api/v1/admin/diplomas — admin only. */
export function createAdminDiplomaRouter(
  auth: CatalogAuth,
  controller: DiplomaController,
  quizController: QuizController,
) {
  const router = Router();
  const adminOnly = [auth.authenticate, auth.requireAdmin];

  router.post(
    "/",
    ...adminOnly,
    validateRequest(createDiplomaSchema.shape.body, "body"),
    controller.createDiploma,
  );
  router.patch(
    "/:diplomaId",
    ...adminOnly,
    validateRequest(updateDiplomaSchema.shape.params, "params"),
    validateRequest(updateDiplomaSchema.shape.body, "body"),
    controller.updateDiploma,
  );
  router.delete(
    "/:diplomaId",
    ...adminOnly,
    validateRequest(diplomaIdSchema.shape.params, "params"),
    controller.archiveDiploma,
  );
  router.get(
    "/:diplomaId/quizzes",
    ...adminOnly,
    validateRequest(diplomaQuizzesSchema.shape.params, "params"),
    validateRequest(diplomaQuizzesSchema.shape.query, "query"),
    controller.listDiplomaQuizzesAdmin,
  );
  router.post(
    "/:diplomaId/quizzes",
    ...adminOnly,
    validateRequest(createQuizSchema.shape.params, "params"),
    validateRequest(createQuizSchema.shape.body, "body"),
    quizController.createQuiz,
  );

  return router;
}
