import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { DiplomaRepository } from "../diploma/diploma.repository.js";
import { DiplomaService } from "../diploma/diploma.service.js";
import { QuizRepository } from "./quiz.repository.js";
import type { CreateQuizInput, UpdateQuizInput } from "./quiz.dto.js";

export class QuizService {
  constructor(
    private readonly quizzes = new QuizRepository(),
    private readonly diplomas = new DiplomaRepository(),
    private readonly diplomaService = new DiplomaService(),
  ) {}

  async create(diplomaId: string, input: CreateQuizInput) {
    const diploma = await this.diplomas.findById(diplomaId);
    if (!diploma || !diploma.isActive) {
      throw new NotFoundError("Active diploma not found");
    }

    const quiz = await this.quizzes.create({
      ...input,
      diplomaId,
      isPublished: false,
      questionsCount: 0,
      totalPoints: 0,
    });
    await this.diplomas.incrementQuizCount(diplomaId, 1);
    return quiz;
  }

  async getById(id: string, studentView = false) {
    const quiz = await this.quizzes.findById(id);
    if (!quiz) throw new NotFoundError("Quiz not found");
    if (studentView && !quiz.isPublished)
      throw new NotFoundError("Quiz not found");
    return quiz;
  }

  async update(id: string, input: UpdateQuizInput) {
    await this.getById(id);
    const updated = await this.quizzes.updateById(id, input);
    if (!updated) throw new NotFoundError("Quiz not found");
    return updated;
  }

  async setPublished(id: string, isPublished: boolean) {
    const quiz = await this.getById(id);
    if (isPublished) {
      if (quiz.questionsCount < 1) {
        throw new ConflictError(
          "A quiz must contain at least one question before publishing",
        );
      }
      if (quiz.durationMinutes < 1) {
        throw new ConflictError("Quiz duration must be at least one minute");
      }
      const diploma = await this.diplomas.findById(String(quiz.diplomaId));
      if (!diploma || !diploma.isActive) {
        throw new ConflictError(
          "Quiz cannot be published under an inactive diploma",
        );
      }
    }
    const updated = await this.quizzes.updateById(id, { isPublished });
    if (!updated) throw new NotFoundError("Quiz not found");
    return updated;
  }

  async archive(id: string) {
    await this.getById(id);
    // Quiz questions and historical attempt snapshots may reference this quiz.
    // Unpublish instead of hard deleting to preserve history and relationships.
    const archived = await this.quizzes.archiveById(id);
    if (!archived) throw new NotFoundError("Quiz not found");
    return archived;
  }

  async listByDiploma(diplomaId: string, page: number, limit: number) {
    return this.diplomaService.getQuizzes(diplomaId, page, limit);
  }

  async getInstructions(id: string) {
    const quiz = await this.getById(id, true);
    return {
      id: String(quiz._id),
      title: quiz.title,
      description: quiz.description,
      durationMinutes: quiz.durationMinutes,
      questionsCount: quiz.questionsCount,
      passingScorePercentage: quiz.passingScorePercentage,
      instructions: quiz.instructions,
    };
  }
}
