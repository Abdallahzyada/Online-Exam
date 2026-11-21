import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { DiplomaService } from "./diploma.service.js";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";

const input = { title: "Frontend", description: "Frontend diploma", imageUrl: "https://example.com/image.jpg" };
const ID = "507f1f77bcf86cd799439011";

describe("DiplomaService", () => {
  const diplomaRepo = {
    findByTitle: jest.fn<(title: string) => Promise<unknown>>(),
    create: jest.fn<(data: typeof input) => Promise<unknown>>(),
    findById: jest.fn<(id: string) => Promise<unknown>>(),
    list: jest.fn<(o: unknown) => Promise<{ items: unknown[]; total: number }>>(),
    updateById: jest.fn<(id: string, data: Record<string, unknown>) => Promise<unknown>>(),
  };
  const quizRepo = {
    listByDiploma: jest.fn<(id: string, o: unknown) => Promise<{ items: unknown[]; total: number }>>(),
    unpublishAllByDiploma: jest.fn<(id: string) => Promise<unknown>>(),
  };
  let service: DiplomaService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new DiplomaService(diplomaRepo as never, quizRepo as never);
  });

  describe("create", () => {
    it("creates a diploma when its title is unique", async () => {
      diplomaRepo.findByTitle.mockResolvedValue(null);
      diplomaRepo.create.mockResolvedValue({ title: "Frontend" });
      await expect(service.create(input)).resolves.toEqual({ title: "Frontend" });
      expect(diplomaRepo.create).toHaveBeenCalledTimes(1);
    });

    it("rejects duplicate diploma titles", async () => {
      diplomaRepo.findByTitle.mockResolvedValue({ _id: "123" });
      await expect(service.create(input)).rejects.toBeInstanceOf(ConflictError);
      expect(diplomaRepo.create).not.toHaveBeenCalled();
    });

    it("maps a unique-index race (E11000) to 409 instead of 500", async () => {
      diplomaRepo.findByTitle.mockResolvedValue(null);
      diplomaRepo.create.mockRejectedValue({ code: 11000 });
      await expect(service.create(input)).rejects.toBeInstanceOf(ConflictError);
    });

    it("does not hide unexpected database errors", async () => {
      diplomaRepo.findByTitle.mockResolvedValue(null);
      diplomaRepo.create.mockRejectedValue(new Error("db down"));
      await expect(service.create(input)).rejects.toThrow("db down");
    });
  });

  describe("getById", () => {
    it("does not return an inactive diploma to students", async () => {
      diplomaRepo.findById.mockResolvedValue({ isActive: false });
      await expect(service.getById(ID)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns an inactive diploma to admins", async () => {
      diplomaRepo.findById.mockResolvedValue({ isActive: false });
      await expect(service.getById(ID, true)).resolves.toEqual({ isActive: false });
    });

    it("throws NotFound for a missing diploma", async () => {
      diplomaRepo.findById.mockResolvedValue(null);
      await expect(service.getById(ID, true)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("list", () => {
    it("returns pagination meta with totalPages", async () => {
      diplomaRepo.list.mockResolvedValue({ items: [{}], total: 25 });
      const result = await service.list(2, 10, "web", false);
      expect(diplomaRepo.list).toHaveBeenCalledWith({ page: 2, limit: 10, includeInactive: false, search: "web" });
      expect(result.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
    });

    it("omits search when none is given", async () => {
      diplomaRepo.list.mockResolvedValue({ items: [], total: 0 });
      await service.list(1, 10);
      expect(diplomaRepo.list).toHaveBeenCalledWith({ page: 1, limit: 10, includeInactive: false });
    });
  });

  describe("update", () => {
    it("rejects a title that belongs to another diploma", async () => {
      diplomaRepo.findById.mockResolvedValue({ title: "Frontend", isActive: true });
      diplomaRepo.findByTitle.mockResolvedValue({ _id: "other" });
      await expect(service.update(ID, { title: "Backend" })).rejects.toBeInstanceOf(ConflictError);
      expect(diplomaRepo.updateById).not.toHaveBeenCalled();
    });

    it("skips the duplicate check when only the casing of the own title changes", async () => {
      diplomaRepo.findById.mockResolvedValue({ title: "Frontend", isActive: true });
      diplomaRepo.updateById.mockResolvedValue({ title: "FRONTEND" });
      await service.update(ID, { title: "FRONTEND" });
      expect(diplomaRepo.findByTitle).not.toHaveBeenCalled();
    });

    it("updates other fields", async () => {
      diplomaRepo.findById.mockResolvedValue({ title: "Frontend", isActive: true });
      diplomaRepo.updateById.mockResolvedValue({ description: "new" });
      await expect(service.update(ID, { description: "new" })).resolves.toEqual({ description: "new" });
    });

    it("maps E11000 on update to 409", async () => {
      diplomaRepo.findById.mockResolvedValue({ title: "Frontend", isActive: true });
      diplomaRepo.findByTitle.mockResolvedValue(null);
      diplomaRepo.updateById.mockRejectedValue({ code: 11000 });
      await expect(service.update(ID, { title: "Backend" })).rejects.toBeInstanceOf(ConflictError);
    });

    it("throws NotFound when the diploma vanished during update", async () => {
      diplomaRepo.findById.mockResolvedValue({ title: "Frontend", isActive: true });
      diplomaRepo.updateById.mockResolvedValue(null);
      await expect(service.update(ID, { description: "x" })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("archive (BR-06)", () => {
    it("unpublishes all quizzes, deactivates the diploma and resets quizzesCount", async () => {
      diplomaRepo.findById.mockResolvedValue({ isActive: true, quizzesCount: 3 });
      diplomaRepo.updateById.mockResolvedValue({ isActive: false });
      await expect(service.archive(ID)).resolves.toEqual({ isActive: false });
      expect(quizRepo.unpublishAllByDiploma).toHaveBeenCalledWith(ID);
      expect(diplomaRepo.updateById).toHaveBeenCalledWith(ID, { isActive: false, quizzesCount: 0 });
    });

    it("is idempotent for an already archived diploma", async () => {
      diplomaRepo.findById.mockResolvedValue({ isActive: false });
      await service.archive(ID);
      expect(quizRepo.unpublishAllByDiploma).not.toHaveBeenCalled();
      expect(diplomaRepo.updateById).not.toHaveBeenCalled();
    });

    it("throws NotFound when the diploma vanished", async () => {
      diplomaRepo.findById.mockResolvedValue({ isActive: true });
      diplomaRepo.updateById.mockResolvedValue(null);
      await expect(service.archive(ID)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("getQuizzes", () => {
    it("lists only published quizzes for students and 404s on an inactive diploma", async () => {
      diplomaRepo.findById.mockResolvedValue({ isActive: false });
      await expect(service.getQuizzes(ID, { page: 1, limit: 10 })).rejects.toBeInstanceOf(NotFoundError);
      expect(quizRepo.listByDiploma).not.toHaveBeenCalled();
    });

    it("returns drafts for admins and builds meta", async () => {
      diplomaRepo.findById.mockResolvedValue({ isActive: false });
      quizRepo.listByDiploma.mockResolvedValue({ items: [{}], total: 11 });
      const result = await service.getQuizzes(ID, { page: 1, limit: 10, search: "ht" }, true);
      expect(quizRepo.listByDiploma).toHaveBeenCalledWith(ID, { page: 1, limit: 10, search: "ht", includeUnpublished: true });
      expect(result.meta.totalPages).toBe(2);
    });
  });
});
