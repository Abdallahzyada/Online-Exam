import { Router } from "express";
import type { DashboardAuth } from "../dashboard/dashboard.ports.js";
import { validateRequest } from "../../common/middlewares/validate-request.js";
import * as quizController from "../quiz/quiz.controller.js";
import {
  createDiplomaSchema,
  diplomaIdSchema,
  listDiplomasSchema,
  updateDiplomaSchema,
} from "./diploma.dto.js";
import { createDiplomaController } from "./diploma.controller.js";
import {
  createQuizSchema,
  diplomaQuizzesSchema,
} from "../quiz/quiz.dto.js";

export function createDiplomaRouter(auth: Pick<DashboardAuth, "authenticate" | "requireAdmin" | "principal">) {
  const router = Router();
  const controller = createDiplomaController(auth);

  router.use(auth.authenticate);
  router.get(
    "/",
    validateRequest(listDiplomasSchema.shape.query, "query"),
    controller.listDiplomas,
  );
  router.get(
    "/:diplomaId",
    validateRequest(diplomaIdSchema.shape.params, "params"),
    controller.getDiploma,
  );
  router.get(
    "/:diplomaId/quizzes",
    validateRequest(diplomaQuizzesSchema.shape.params, "params"),
    validateRequest(diplomaQuizzesSchema.shape.query, "query"),
    quizController.listDiplomaQuizzes,
  );
  router.post(
    "/:diplomaId/quizzes",
    auth.requireAdmin,
    validateRequest(createQuizSchema.shape.params, "params"),
    validateRequest(createQuizSchema.shape.body, "body"),
    quizController.createQuiz,
  );
  router.post(
    "/",
    auth.requireAdmin,
    validateRequest(createDiplomaSchema.shape.body, "body"),
    controller.createDiploma,
  );
  router.patch(
    "/:diplomaId",
    auth.requireAdmin,
    validateRequest(updateDiplomaSchema.shape.params, "params"),
    validateRequest(updateDiplomaSchema.shape.body, "body"),
    controller.updateDiploma,
  );
  router.delete(
    "/:diplomaId",
    auth.requireAdmin,
    validateRequest(diplomaIdSchema.shape.params, "params"),
    controller.archiveDiploma,
  );

  return router;
}
