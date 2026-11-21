import type { RequestHandler } from "express";
import { paginated, success } from "../../common/utils/response-envelope.js";
import { QuizService } from "./quiz.service.js";

const service = new QuizService();

export const createQuiz: RequestHandler = async (_req, res) => {
  const { diplomaId } = res.locals.params;
  const result = await service.create(diplomaId, res.locals.body);
  res.status(201).json(success(result));
};

export const listDiplomaQuizzes: RequestHandler = async (_req, res) => {
  const { diplomaId } = res.locals.params;
  const { page, limit } = res.locals.query;
  const result = await service.listByDiploma(diplomaId, page, limit);
  res.status(200).json(paginated(result.items, result.meta));
};

export const getQuizInstructions: RequestHandler = async (_req, res) => {
  const { quizId } = res.locals.params;
  const result = await service.getInstructions(quizId);
  res.status(200).json(success(result));
};

export const getQuizAdmin: RequestHandler = async (_req, res) => {
  const { quizId } = res.locals.params;
  const result = await service.getById(quizId);
  res.status(200).json(success(result));
};

export const updateQuiz: RequestHandler = async (_req, res) => {
  const { quizId } = res.locals.params;
  const result = await service.update(quizId, res.locals.body);
  res.status(200).json(success(result));
};

export const publishQuiz: RequestHandler = async (_req, res) => {
  const { quizId } = res.locals.params;
  const { isPublished } = res.locals.body;
  const result = await service.setPublished(quizId, isPublished);
  res.status(200).json(success(result));
};

export const archiveQuiz: RequestHandler = async (_req, res) => {
  const { quizId } = res.locals.params;
  const result = await service.archive(quizId);
  res.status(200).json(success(result));
};
