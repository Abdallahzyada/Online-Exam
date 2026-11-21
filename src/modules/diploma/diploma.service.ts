import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { isDuplicateKeyError } from "../../common/utils/mongo-errors.js";
import { DiplomaRepository } from "./diploma.repository.js";
import { QuizRepository, type QuizListOptions } from "../quiz/quiz.repository.js";
import type { CreateDiplomaInput, UpdateDiplomaInput } from "./diploma.dto.js";

const DUPLICATE_TITLE = "A diploma with this title already exists";

export class DiplomaService {
  constructor(
    private readonly diplomas = new DiplomaRepository(),
    private readonly quizzes = new QuizRepository()
  ) {}

  async create(input: CreateDiplomaInput) {
    const existing = await this.diplomas.findByTitle(input.title);
    if (existing) throw new ConflictError(DUPLICATE_TITLE);
    try {
      return await this.diplomas.create(input);
    } catch (error: unknown) {
      // Two parallel creates can both pass the check above; the unique index decides.
      if (isDuplicateKeyError(error)) throw new ConflictError(DUPLICATE_TITLE);
      throw error;
    }
  }

  async getById(id: string, includeInactive = false) {
    const diploma = await this.diplomas.findById(id);
    if (!diploma || (!includeInactive && !diploma.isActive)) {
      throw new NotFoundError("Diploma not found");
    }
    return diploma;
  }

  async list(page: number, limit: number, search?: string, includeInactive = false) {
    const result = await this.diplomas.list({
      page, limit, includeInactive,
      ...(search !== undefined ? { search } : {})
    });
    return {
      ...result,
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit)
      }
    };
  }

  async update(id: string, input: UpdateDiplomaInput) {
    const diploma = await this.getById(id, true);
    if (input.title && input.title.toLowerCase() !== diploma.title.toLowerCase()) {
      const duplicate = await this.diplomas.findByTitle(input.title);
      if (duplicate) throw new ConflictError(DUPLICATE_TITLE);
    }
    try {
      const updated = await this.diplomas.updateById(id, input);
      if (!updated) throw new NotFoundError("Diploma not found");
      return updated;
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) throw new ConflictError(DUPLICATE_TITLE);
      throw error;
    }
  }

  /**
   * Safe archive (BR-06): the diploma is kept (history/attempts stay valid) but becomes inactive,
   * and every quiz under it is unpublished so students can no longer open or start them.
   */
  async archive(id: string) {
    const diploma = await this.getById(id, true);
    if (!diploma.isActive) return diploma; // already archived: idempotent
    await this.quizzes.unpublishAllByDiploma(id);
    const archived = await this.diplomas.updateById(id, { isActive: false, quizzesCount: 0 });
    if (!archived) throw new NotFoundError("Diploma not found");
    return archived;
  }

  /** `asAdmin` also returns inactive diplomas and unpublished (draft) quizzes. */
  async getQuizzes(
    diplomaId: string,
    options: Omit<QuizListOptions, "includeUnpublished">,
    asAdmin = false
  ) {
    await this.getById(diplomaId, asAdmin);
    const result = await this.quizzes.listByDiploma(diplomaId, { ...options, includeUnpublished: asAdmin });
    return {
      ...result,
      meta: {
        page: options.page,
        limit: options.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / options.limit)
      }
    };
  }
}
