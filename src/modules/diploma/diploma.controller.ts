import type { RequestHandler } from "express";
import { paginated, success } from "../../common/utils/response-envelope.js";
import type { DashboardAuth } from "../dashboard/dashboard.ports.js";
import { DiplomaService } from "./diploma.service.js";

export function createDiplomaController(auth: Pick<DashboardAuth, "principal">) {
  const service = new DiplomaService();

  const createDiploma: RequestHandler = async (_req, res) => {
    const result = await service.create(res.locals.body);
    res.status(201).json(success(result));
  };

  const listDiplomas: RequestHandler = async (req, res) => {
    const { page, limit, search, includeInactive } = res.locals.query;
    const isAdmin = auth.principal(req).role === "admin";
    const result = await service.list(page, limit, search, isAdmin && includeInactive === "true");
    res.status(200).json(paginated(result.items, result.meta));
  };

  const getDiploma: RequestHandler = async (req, res) => {
    const { diplomaId } = res.locals.params;
    const result = await service.getById(
      diplomaId,
      auth.principal(req).role === "admin",
    );
    res.status(200).json(success(result));
  };

  const updateDiploma: RequestHandler = async (_req, res) => {
    const { diplomaId } = res.locals.params;
    const result = await service.update(diplomaId, res.locals.body);
    res.status(200).json(success(result));
  };

  const archiveDiploma: RequestHandler = async (_req, res) => {
    const { diplomaId } = res.locals.params;
    const result = await service.archive(diplomaId);
    res.status(200).json(success(result));
  };

  return { createDiploma, listDiplomas, getDiploma, updateDiploma, archiveDiploma };
}
