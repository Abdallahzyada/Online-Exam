import { NotFoundError } from '../../common/errors/app-error.js';
import type { QuestionInput, QuestionPatch } from './question.dto.js';
import { toQuestionDto } from './question.dto.js';
import type { QuestionRepository, ImportReport } from './question.ports.js';
import { importNdjsonQuestions } from './question.streams.js';
import type { Readable } from 'node:stream';

export class QuestionService {
  constructor(private readonly repository: QuestionRepository) {}

  async createQuestion(quizId: string, input: QuestionInput) {
    return toQuestionDto(await this.repository.create(quizId, input));
  }

  async updateQuestion(questionId: string, patch: QuestionPatch) {
    const updated = await this.repository.update(questionId, patch);
    if (!updated) throw new NotFoundError('Question');
    return toQuestionDto(updated);
  }

  async deleteQuestion(questionId: string): Promise<{ questionId: string; deleted: true }> {
    const deleted = await this.repository.delete(questionId);
    if (!deleted) throw new NotFoundError('Question');
    return { questionId, deleted: true };
  }

  async importQuestions(quizId: string, source: Readable): Promise<ImportReport> {
    if (!await this.repository.quizExists(quizId)) throw new NotFoundError('Quiz');
    return await importNdjsonQuestions(source, batch => this.repository.insertMany(quizId, batch));
  }

  async ensureQuizExists(quizId: string): Promise<void> {
    if (!await this.repository.quizExists(quizId)) throw new NotFoundError('Quiz');
  }

  async questionExportCursor(quizId: string): Promise<Readable> {
    await this.ensureQuizExists(quizId);
    return this.repository.findByQuizCursor(quizId);
  }
}

