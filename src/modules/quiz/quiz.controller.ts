import type { RequestHandler } from "express";
import { success } from "../../common/utils/response-envelope.js";
import { toQuizDto } from "./quiz.dto.js";
import { QuizService } from "./quiz.service.js";

export function createQuizController(service: QuizService = new QuizService()) {
  const createQuiz: RequestHandler = async (_req, res) => {
    const { diplomaId } = res.locals.params;
    const result = await service.create(diplomaId, res.locals.body);
    res.status(201).json(success(toQuizDto(result)));
  };

  /** Student: instructions modal data (published quizzes only). */
  const getQuizInstructions: RequestHandler = async (_req, res) => {
    const { quizId } = res.locals.params;
    const result = await service.getInstructions(quizId);
    res.status(200).json(success(result));
  };

  const getQuizAdmin: RequestHandler = async (_req, res) => {
    const { quizId } = res.locals.params;
    const result = await service.getById(quizId);
    res.status(200).json(success(toQuizDto(result)));
  };

  /** Edit fields and/or publish/unpublish (`isPublished`). */
  const updateQuiz: RequestHandler = async (_req, res) => {
    const { quizId } = res.locals.params;
    const result = await service.update(quizId, res.locals.body);
    res.status(200).json(success(toQuizDto(result)));
  };

  const archiveQuiz: RequestHandler = async (_req, res) => {
    const { quizId } = res.locals.params;
    const result = await service.archive(quizId);
    res.status(200).json(success(toQuizDto(result)));
  };

  return { createQuiz, getQuizInstructions, getQuizAdmin, updateQuiz, archiveQuiz };
}

export type QuizController = ReturnType<typeof createQuizController>;
