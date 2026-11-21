import type { RequestHandler } from "express";
import { paginated, success } from "../../common/utils/response-envelope.js";
import type { DashboardAuth } from "../dashboard/dashboard.ports.js";
import { toQuizDto } from "../quiz/quiz.dto.js";
import { toDiplomaDto } from "./diploma.dto.js";
import { DiplomaService } from "./diploma.service.js";

export function createDiplomaController(
  auth: Pick<DashboardAuth, "principal">,
  service: DiplomaService = new DiplomaService(),
) {
  const isAdmin = (req: Parameters<RequestHandler>[0]) => auth.principal(req).role === "admin";

  const createDiploma: RequestHandler = async (_req, res) => {
    const result = await service.create(res.locals.body);
    res.status(201).json(success(toDiplomaDto(result)));
  };

  const listDiplomas: RequestHandler = async (req, res) => {
    const { page, limit, search, includeInactive } = res.locals.query;
    const result = await service.list(page, limit, search, isAdmin(req) && includeInactive === "true");
    res.status(200).json(paginated(result.items.map(toDiplomaDto), result.meta));
  };

  const getDiploma: RequestHandler = async (req, res) => {
    const { diplomaId } = res.locals.params;
    const result = await service.getById(diplomaId, isAdmin(req));
    res.status(200).json(success(toDiplomaDto(result)));
  };

  const updateDiploma: RequestHandler = async (_req, res) => {
    const { diplomaId } = res.locals.params;
    const result = await service.update(diplomaId, res.locals.body);
    res.status(200).json(success(toDiplomaDto(result)));
  };

  const archiveDiploma: RequestHandler = async (_req, res) => {
    const { diplomaId } = res.locals.params;
    const result = await service.archive(diplomaId);
    res.status(200).json(success(toDiplomaDto(result)));
  };

  /** Student: published quizzes of an active diploma. */
  const listDiplomaQuizzes: RequestHandler = async (_req, res) => {
    const { diplomaId } = res.locals.params;
    const { page, limit, search, category } = res.locals.query;
    const result = await service.getQuizzes(diplomaId, { page, limit, search, category });
    res.status(200).json(paginated(result.items.map(toQuizDto), result.meta));
  };

  /** Admin: every quiz of the diploma including drafts (needed to find and publish them). */
  const listDiplomaQuizzesAdmin: RequestHandler = async (_req, res) => {
    const { diplomaId } = res.locals.params;
    const { page, limit, search, category } = res.locals.query;
    const result = await service.getQuizzes(diplomaId, { page, limit, search, category }, true);
    res.status(200).json(paginated(result.items.map(toQuizDto), result.meta));
  };

  return {
    createDiploma, listDiplomas, getDiploma, updateDiploma, archiveDiploma,
    listDiplomaQuizzes, listDiplomaQuizzesAdmin
  };
}

export type DiplomaController = ReturnType<typeof createDiplomaController>;
