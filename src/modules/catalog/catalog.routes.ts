import { Router } from "express";
import type { DashboardAuth } from "../dashboard/dashboard.ports.js";
import { createDiplomaController, type DiplomaController } from "../diploma/diploma.controller.js";
import { createAdminDiplomaRouter, createDiplomaRouter } from "../diploma/diploma.routes.js";
import { DiplomaService } from "../diploma/diploma.service.js";
import { createQuizController, type QuizController } from "../quiz/quiz.controller.js";
import { createAdminQuizRouter, createQuizRouter } from "../quiz/quiz.routes.js";
import { QuizService } from "../quiz/quiz.service.js";
import { DiplomaRepository } from "../diploma/diploma.repository.js";
import { QuizRepository } from "../quiz/quiz.repository.js";

export interface CatalogControllers {
  readonly diploma: DiplomaController;
  readonly quiz: QuizController;
}

/**
 * Single entry point for the catalog slice. Mount it once under /api/v1:
 *   /diplomas, /diplomas/:id/quizzes, /quizzes/:id            (authenticated)
 *   /admin/diplomas..., /admin/quizzes/:id                    (admin only)
 */
export function createCatalogRouter(
  auth: Pick<DashboardAuth, "authenticate" | "requireAdmin" | "principal">,
  controllers?: CatalogControllers,
) {
  const resolved = controllers ?? defaultControllers(auth);
  const router = Router();
  router.use("/diplomas", createDiplomaRouter(auth, resolved.diploma));
  router.use("/quizzes", createQuizRouter(auth, resolved.quiz));
  router.use("/admin/diplomas", createAdminDiplomaRouter(auth, resolved.diploma, resolved.quiz));
  router.use("/admin/quizzes", createAdminQuizRouter(auth, resolved.quiz));
  return router;
}

function defaultControllers(auth: Pick<DashboardAuth, "principal">): CatalogControllers {
  const quizzes = new QuizRepository();
  const diplomas = new DiplomaRepository();
  const diplomaService = new DiplomaService(diplomas, quizzes);
  return {
    diploma: createDiplomaController(auth, diplomaService),
    quiz: createQuizController(new QuizService(quizzes, diplomas, diplomaService)),
  };
}
