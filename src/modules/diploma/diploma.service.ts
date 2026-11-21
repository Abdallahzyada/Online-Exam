import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { DiplomaRepository } from "./diploma.repository.js";
import { QuizRepository } from "../quiz/quiz.repository.js";
import type { CreateDiplomaInput, UpdateDiplomaInput } from "./diploma.dto.js";

export class DiplomaService {
  constructor(
    private readonly diplomas = new DiplomaRepository(),
    private readonly quizzes = new QuizRepository()
  ) {}

  async create(input: CreateDiplomaInput) {
    const existing = await this.diplomas.findByTitle(input.title);
    if (existing) throw new ConflictError("A diploma with this title already exists");
    return this.diplomas.create(input);
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
      if (duplicate) throw new ConflictError("A diploma with this title already exists");
    }
    const updated = await this.diplomas.updateById(id, input);
    if (!updated) throw new NotFoundError("Diploma not found");
    return updated;
  }

  async archive(id: string) {
    const diploma = await this.getById(id, true);
    if (diploma.quizzesCount > 0) {
      // Safe archive preserves quiz and attempt references.
      const archived = await this.diplomas.updateById(id, { isActive: false });
      if (!archived) throw new NotFoundError("Diploma not found");
      return archived;
    }
    const archived = await this.diplomas.updateById(id, { isActive: false });
    if (!archived) throw new NotFoundError("Diploma not found");
    return archived;
  }

  async getQuizzes(diplomaId: string, page: number, limit: number) {
    await this.getById(diplomaId);
    const result = await this.quizzes.listByDiploma(diplomaId, page, limit);
    return {
      ...result,
      meta: {
        page, limit, total: result.total,
        totalPages: Math.ceil(result.total / limit)
      }
    };
  }
}
