import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { isDuplicateKeyError } from "../../common/utils/mongo-errors.js";
import { DiplomaRepository } from "../diploma/diploma.repository.js";
import { DiplomaService } from "../diploma/diploma.service.js";
import { QuizRepository, type QuizListOptions } from "./quiz.repository.js";
import type { CreateQuizInput, UpdateQuizInput } from "./quiz.dto.js";

const DUPLICATE_TITLE = "A quiz with this title already exists in this diploma";

export class QuizService {
  constructor(
    private readonly quizzes = new QuizRepository(),
    private readonly diplomas = new DiplomaRepository(),
    private readonly diplomaService = new DiplomaService(),
  ) {}

  /** New quizzes are always drafts (BR-07), so `diploma.quizzesCount` (published quizzes) is untouched. */
  async create(diplomaId: string, input: CreateQuizInput) {
    const diploma = await this.diplomas.findById(diplomaId);
    if (!diploma || !diploma.isActive) {
      throw new NotFoundError("Active diploma not found");
    }
    if (await this.quizzes.findByTitleInDiploma(diplomaId, input.title)) {
      throw new ConflictError(DUPLICATE_TITLE);
    }
    try {
      return await this.quizzes.create({
        ...input,
        diplomaId,
        isPublished: false,
        questionsCount: 0,
        totalPoints: 0,
      });
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) throw new ConflictError(DUPLICATE_TITLE);
      throw error;
    }
  }

  async getById(id: string, studentView = false) {
    const quiz = await this.quizzes.findById(id);
    if (!quiz || quiz.isArchived) throw new NotFoundError("Quiz not found");
    if (studentView && !quiz.isPublished) throw new NotFoundError("Quiz not found");
    return quiz;
  }

  /** Edit fields and/or publish/unpublish in one PATCH. Publish rules are checked first. */
  async update(id: string, input: UpdateQuizInput) {
    const { isPublished, ...fields } = input;
    const quiz = await this.getById(id);

    if (fields.title && fields.title.toLowerCase() !== quiz.title.toLowerCase()) {
      if (await this.quizzes.findByTitleInDiploma(String(quiz.diplomaId), fields.title)) {
        throw new ConflictError(DUPLICATE_TITLE);
      }
    }

    let current = quiz;
    if (isPublished !== undefined) current = await this.setPublished(id, isPublished);
    if (Object.keys(fields).length === 0) return current;

    try {
      const updated = await this.quizzes.updateById(id, fields);
      if (!updated) throw new NotFoundError("Quiz not found");
      return updated;
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) throw new ConflictError(DUPLICATE_TITLE);
      throw error;
    }
  }

  async setPublished(id: string, isPublished: boolean) {
    const quiz = await this.getById(id);
    if (quiz.isPublished === isPublished) return quiz; // no change, counters untouched
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
    await this.diplomas.incrementQuizCount(String(quiz.diplomaId), isPublished ? 1 : -1);
    return updated;
  }

  /** "Delete Quiz": soft delete. Questions and attempt snapshots may still reference it. */
  async archive(id: string) {
    const quiz = await this.getById(id);
    const archived = await this.quizzes.archiveById(id);
    if (!archived) throw new NotFoundError("Quiz not found");
    if (quiz.isPublished) {
      await this.diplomas.incrementQuizCount(String(quiz.diplomaId), -1);
    }
    return archived;
  }

  async listByDiploma(
    diplomaId: string,
    options: Omit<QuizListOptions, "includeUnpublished">,
    asAdmin = false
  ) {
    return this.diplomaService.getQuizzes(diplomaId, options, asAdmin);
  }

  async getInstructions(id: string) {
    const quiz = await this.getById(id, true);
    // BR-06: a quiz is only usable while its diploma is active.
    const diploma = await this.diplomas.findById(String(quiz.diplomaId));
    if (!diploma || !diploma.isActive) throw new NotFoundError("Quiz not found");
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

  /**
   * Hook for the Question module (BR-07 / spec §2): keeps questionsCount and totalPoints in sync
   * and un-publishes the quiz if its last question was removed.
   */
  async applyQuestionDelta(id: string, questionsDelta: number, pointsDelta: number) {
    const updated = await this.quizzes.applyQuestionDelta(id, questionsDelta, pointsDelta);
    if (!updated || updated.isArchived) throw new NotFoundError("Quiz not found");
    if (updated.isPublished && updated.questionsCount < 1) {
      const unpublished = await this.quizzes.updateById(id, { isPublished: false });
      await this.diplomas.incrementQuizCount(String(updated.diplomaId), -1);
      return unpublished ?? updated;
    }
    return updated;
  }
}
