import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { QuizService } from "./quiz.service.js";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";

describe("QuizService", () => {
  const quizRepo = {
    create: jest.fn<(data: Record<string, unknown>) => Promise<unknown>>(),
    findById: jest.fn<(id: string) => Promise<unknown>>(),
    updateById: jest.fn<(id: string, data: Record<string, unknown>) => Promise<unknown>>(),
    archiveById: jest.fn<(id: string) => Promise<unknown>>()
  };
  const diplomaRepo = {
    findById: jest.fn<(id: string) => Promise<unknown>>(),
    incrementQuizCount: jest.fn()
  };
  const diplomaService = { getQuizzes: jest.fn() };
  let service: QuizService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QuizService(
      quizRepo as never,
      diplomaRepo as never,
      diplomaService as never
    );
  });

  it("creates a quiz under an active diploma and starts it unpublished", async () => {
    diplomaRepo.findById.mockResolvedValue({ isActive: true });
    quizRepo.create.mockResolvedValue({ isPublished: false });

    await service.create("507f1f77bcf86cd799439011", {
      title: "HTML",
      description: "HTML quiz",
      imageUrl: "https://example.com/html.jpg",
      category: "Front-End",
      durationMinutes: 15,
      passingScorePercentage: 50,
      instructions: ["Read carefully"]
    });

    expect(quizRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      isPublished: false,
      questionsCount: 0,
      totalPoints: 0
    }));
    expect(diplomaRepo.incrementQuizCount).toHaveBeenCalledWith(
      "507f1f77bcf86cd799439011", 1
    );
  });

  it("does not create a quiz under an inactive or missing diploma", async () => {
    diplomaRepo.findById.mockResolvedValue(null);

    await expect(service.create("507f1f77bcf86cd799439011", {
      title: "HTML",
      description: "HTML quiz",
      imageUrl: "https://example.com/html.jpg",
      category: "Front-End",
      durationMinutes: 15,
      passingScorePercentage: 50,
      instructions: []
    })).rejects.toBeInstanceOf(NotFoundError);

    expect(quizRepo.create).not.toHaveBeenCalled();
  });

  it("prevents publishing a quiz with no questions", async () => {
    quizRepo.findById.mockResolvedValue({
      questionsCount: 0,
      durationMinutes: 15
    });

    await expect(service.setPublished("507f1f77bcf86cd799439011", true))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it("unpublishes a quiz instead of hard deleting it", async () => {
    quizRepo.findById.mockResolvedValue({ _id: "q1" });
    quizRepo.archiveById.mockResolvedValue({ isPublished: false });

    await expect(service.archive("507f1f77bcf86cd799439011"))
      .resolves.toEqual({ isPublished: false });
    expect(quizRepo.archiveById).toHaveBeenCalledTimes(1);
  });
});
