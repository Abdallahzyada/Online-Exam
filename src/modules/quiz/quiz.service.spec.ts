import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { QuizService } from "./quiz.service.js";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";

const DIPLOMA = "507f1f77bcf86cd799439011";
const ID = "507f1f77bcf86cd799439022";
const input = {
  title: "HTML", description: "HTML quiz", imageUrl: "https://example.com/html.jpg",
  category: "Front-End", durationMinutes: 15, passingScorePercentage: 50, instructions: ["Read carefully"]
};

describe("QuizService", () => {
  const quizRepo = {
    create: jest.fn<(data: Record<string, unknown>) => Promise<unknown>>(),
    findById: jest.fn<(id: string) => Promise<unknown>>(),
    findByTitleInDiploma: jest.fn<(d: string, t: string) => Promise<unknown>>(),
    updateById: jest.fn<(id: string, data: Record<string, unknown>) => Promise<unknown>>(),
    archiveById: jest.fn<(id: string) => Promise<unknown>>(),
    applyQuestionDelta: jest.fn<(id: string, q: number, p: number) => Promise<unknown>>()
  };
  const diplomaRepo = {
    findById: jest.fn<(id: string) => Promise<unknown>>(),
    incrementQuizCount: jest.fn<(id: string, n: number) => Promise<unknown>>()
  };
  const diplomaService = { getQuizzes: jest.fn<(...a: unknown[]) => Promise<unknown>>() };
  let service: QuizService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new QuizService(quizRepo as never, diplomaRepo as never, diplomaService as never);
  });

  describe("create", () => {
    it("creates an unpublished draft and does not touch the published counter", async () => {
      diplomaRepo.findById.mockResolvedValue({ isActive: true });
      quizRepo.findByTitleInDiploma.mockResolvedValue(null);
      quizRepo.create.mockResolvedValue({ isPublished: false });
      await service.create(DIPLOMA, input);
      expect(quizRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        diplomaId: DIPLOMA, isPublished: false, questionsCount: 0, totalPoints: 0
      }));
      expect(diplomaRepo.incrementQuizCount).not.toHaveBeenCalled();
    });

    it("does not create a quiz under an inactive or missing diploma", async () => {
      diplomaRepo.findById.mockResolvedValue(null);
      await expect(service.create(DIPLOMA, input)).rejects.toBeInstanceOf(NotFoundError);
      diplomaRepo.findById.mockResolvedValue({ isActive: false });
      await expect(service.create(DIPLOMA, input)).rejects.toBeInstanceOf(NotFoundError);
      expect(quizRepo.create).not.toHaveBeenCalled();
    });

    it("rejects a duplicate title inside the same diploma", async () => {
      diplomaRepo.findById.mockResolvedValue({ isActive: true });
      quizRepo.findByTitleInDiploma.mockResolvedValue({ _id: "x" });
      await expect(service.create(DIPLOMA, input)).rejects.toBeInstanceOf(ConflictError);
      expect(quizRepo.create).not.toHaveBeenCalled();
    });

    it("maps a unique-index race to 409 and rethrows other errors", async () => {
      diplomaRepo.findById.mockResolvedValue({ isActive: true });
      quizRepo.findByTitleInDiploma.mockResolvedValue(null);
      quizRepo.create.mockRejectedValueOnce({ code: 11000 });
      await expect(service.create(DIPLOMA, input)).rejects.toBeInstanceOf(ConflictError);
      quizRepo.create.mockRejectedValueOnce(new Error("db down"));
      await expect(service.create(DIPLOMA, input)).rejects.toThrow("db down");
    });
  });

  describe("getById", () => {
    it("404s on missing and archived quizzes", async () => {
      quizRepo.findById.mockResolvedValue(null);
      await expect(service.getById(ID)).rejects.toBeInstanceOf(NotFoundError);
      quizRepo.findById.mockResolvedValue({ isArchived: true });
      await expect(service.getById(ID)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("hides drafts from students but not from admins", async () => {
      quizRepo.findById.mockResolvedValue({ isPublished: false });
      await expect(service.getById(ID, true)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.getById(ID)).resolves.toEqual({ isPublished: false });
    });
  });

  describe("setPublished (BR-07)", () => {
    it("prevents publishing a quiz with no questions", async () => {
      quizRepo.findById.mockResolvedValue({ questionsCount: 0, durationMinutes: 15 });
      await expect(service.setPublished(ID, true)).rejects.toBeInstanceOf(ConflictError);
      expect(quizRepo.updateById).not.toHaveBeenCalled();
    });

    it("prevents publishing with an invalid duration", async () => {
      quizRepo.findById.mockResolvedValue({ questionsCount: 5, durationMinutes: 0 });
      await expect(service.setPublished(ID, true)).rejects.toBeInstanceOf(ConflictError);
    });

    it("prevents publishing under an inactive diploma", async () => {
      quizRepo.findById.mockResolvedValue({ questionsCount: 5, durationMinutes: 15, diplomaId: DIPLOMA });
      diplomaRepo.findById.mockResolvedValue({ isActive: false });
      await expect(service.setPublished(ID, true)).rejects.toBeInstanceOf(ConflictError);
    });

    it("publishes and increments the diploma's published counter", async () => {
      quizRepo.findById.mockResolvedValue({ questionsCount: 5, durationMinutes: 15, diplomaId: DIPLOMA, isPublished: false });
      diplomaRepo.findById.mockResolvedValue({ isActive: true });
      quizRepo.updateById.mockResolvedValue({ isPublished: true });
      await expect(service.setPublished(ID, true)).resolves.toEqual({ isPublished: true });
      expect(diplomaRepo.incrementQuizCount).toHaveBeenCalledWith(DIPLOMA, 1);
    });

    it("unpublishes and decrements the counter", async () => {
      quizRepo.findById.mockResolvedValue({ diplomaId: DIPLOMA, isPublished: true });
      quizRepo.updateById.mockResolvedValue({ isPublished: false });
      await service.setPublished(ID, false);
      expect(diplomaRepo.incrementQuizCount).toHaveBeenCalledWith(DIPLOMA, -1);
    });

    it("does nothing (and keeps counters) when the state is unchanged", async () => {
      const quiz = { diplomaId: DIPLOMA, isPublished: true };
      quizRepo.findById.mockResolvedValue(quiz);
      await expect(service.setPublished(ID, true)).resolves.toBe(quiz);
      expect(quizRepo.updateById).not.toHaveBeenCalled();
      expect(diplomaRepo.incrementQuizCount).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("rejects renaming to a title used by another quiz of the diploma", async () => {
      quizRepo.findById.mockResolvedValue({ title: "HTML", diplomaId: DIPLOMA });
      quizRepo.findByTitleInDiploma.mockResolvedValue({ _id: "other" });
      await expect(service.update(ID, { title: "CSS" })).rejects.toBeInstanceOf(ConflictError);
      expect(quizRepo.updateById).not.toHaveBeenCalled();
    });

    it("updates plain fields", async () => {
      quizRepo.findById.mockResolvedValue({ title: "HTML", diplomaId: DIPLOMA });
      quizRepo.updateById.mockResolvedValue({ durationMinutes: 20 });
      await expect(service.update(ID, { durationMinutes: 20 })).resolves.toEqual({ durationMinutes: 20 });
      expect(quizRepo.updateById).toHaveBeenCalledWith(ID, { durationMinutes: 20 });
    });

    it("handles isPublished through the publish guard, before editing fields", async () => {
      quizRepo.findById.mockResolvedValue({ title: "HTML", diplomaId: DIPLOMA, questionsCount: 0, durationMinutes: 15, isPublished: false });
      await expect(service.update(ID, { isPublished: true, durationMinutes: 20 })).rejects.toBeInstanceOf(ConflictError);
      expect(quizRepo.updateById).not.toHaveBeenCalled();
    });

    it("returns the publish result when only isPublished is sent", async () => {
      quizRepo.findById.mockResolvedValue({ diplomaId: DIPLOMA, isPublished: true });
      quizRepo.updateById.mockResolvedValue({ isPublished: false });
      await expect(service.update(ID, { isPublished: false })).resolves.toEqual({ isPublished: false });
      expect(quizRepo.updateById).toHaveBeenCalledTimes(1);
    });

    it("maps E11000 to 409 and 404s when the quiz vanished", async () => {
      quizRepo.findById.mockResolvedValue({ title: "HTML", diplomaId: DIPLOMA });
      quizRepo.updateById.mockRejectedValueOnce({ code: 11000 });
      await expect(service.update(ID, { description: "x" })).rejects.toBeInstanceOf(ConflictError);
      quizRepo.updateById.mockResolvedValueOnce(null);
      await expect(service.update(ID, { description: "x" })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("archive", () => {
    it("soft-deletes a published quiz and decrements the counter", async () => {
      quizRepo.findById.mockResolvedValue({ diplomaId: DIPLOMA, isPublished: true });
      quizRepo.archiveById.mockResolvedValue({ isArchived: true });
      await expect(service.archive(ID)).resolves.toEqual({ isArchived: true });
      expect(diplomaRepo.incrementQuizCount).toHaveBeenCalledWith(DIPLOMA, -1);
    });

    it("does not touch the counter for a draft", async () => {
      quizRepo.findById.mockResolvedValue({ diplomaId: DIPLOMA, isPublished: false });
      quizRepo.archiveById.mockResolvedValue({ isArchived: true });
      await service.archive(ID);
      expect(diplomaRepo.incrementQuizCount).not.toHaveBeenCalled();
    });

    it("404s when the quiz vanished", async () => {
      quizRepo.findById.mockResolvedValue({ diplomaId: DIPLOMA });
      quizRepo.archiveById.mockResolvedValue(null);
      await expect(service.archive(ID)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("getInstructions", () => {
    const quiz = {
      _id: ID, diplomaId: DIPLOMA, title: "HTML", description: "d", durationMinutes: 15,
      questionsCount: 20, passingScorePercentage: 50, instructions: ["a"], isPublished: true
    };

    it("returns only the instructions-modal fields", async () => {
      quizRepo.findById.mockResolvedValue(quiz);
      diplomaRepo.findById.mockResolvedValue({ isActive: true });
      await expect(service.getInstructions(ID)).resolves.toEqual({
        id: ID, title: "HTML", description: "d", durationMinutes: 15,
        questionsCount: 20, passingScorePercentage: 50, instructions: ["a"]
      });
    });

    it("404s for drafts and for quizzes under an inactive diploma (BR-06)", async () => {
      quizRepo.findById.mockResolvedValue({ ...quiz, isPublished: false });
      await expect(service.getInstructions(ID)).rejects.toBeInstanceOf(NotFoundError);
      quizRepo.findById.mockResolvedValue(quiz);
      diplomaRepo.findById.mockResolvedValue({ isActive: false });
      await expect(service.getInstructions(ID)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("listByDiploma", () => {
    it("delegates to the diploma service with the admin flag", async () => {
      diplomaService.getQuizzes.mockResolvedValue({ items: [], total: 0, meta: {} });
      await service.listByDiploma(DIPLOMA, { page: 1, limit: 10 }, true);
      expect(diplomaService.getQuizzes).toHaveBeenCalledWith(DIPLOMA, { page: 1, limit: 10 }, true);
    });
  });

  describe("applyQuestionDelta (hook for the Question module)", () => {
    it("syncs counters through the repository", async () => {
      const updated = { isPublished: false, questionsCount: 3, totalPoints: 6, diplomaId: DIPLOMA };
      quizRepo.applyQuestionDelta.mockResolvedValue(updated);
      await expect(service.applyQuestionDelta(ID, 1, 2)).resolves.toBe(updated);
      expect(quizRepo.applyQuestionDelta).toHaveBeenCalledWith(ID, 1, 2);
    });

    it("unpublishes a published quiz whose last question was removed (BR-07)", async () => {
      quizRepo.applyQuestionDelta.mockResolvedValue({ isPublished: true, questionsCount: 0, diplomaId: DIPLOMA });
      quizRepo.updateById.mockResolvedValue({ isPublished: false });
      await expect(service.applyQuestionDelta(ID, -1, -1)).resolves.toEqual({ isPublished: false });
      expect(diplomaRepo.incrementQuizCount).toHaveBeenCalledWith(DIPLOMA, -1);
    });

    it("404s for a missing or archived quiz", async () => {
      quizRepo.applyQuestionDelta.mockResolvedValue(null);
      await expect(service.applyQuestionDelta(ID, 1, 1)).rejects.toBeInstanceOf(NotFoundError);
      quizRepo.applyQuestionDelta.mockResolvedValue({ isArchived: true });
      await expect(service.applyQuestionDelta(ID, 1, 1)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
