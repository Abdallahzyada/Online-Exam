import { describe, expect, it, jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { Types } from 'mongoose';
import { NotFoundError } from '../../common/errors/app-error.js';
import type { QuestionInput, QuestionPatch } from './question.dto.js';
import type { QuestionRepository } from './question.ports.js';
import type { QuestionRecord } from './question.model.js';
import { QuestionService } from './question.service.js';

const quizId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const questionId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const now = new Date('2026-01-01T00:00:00.000Z');
const record: QuestionRecord = {
  _id: new Types.ObjectId(questionId), quizId: new Types.ObjectId(quizId),
  type: 'single', text: 'Question?',
  options: [{ optionId: 'a', text: 'A' }, { optionId: 'b', text: 'B' }],
  correctOptionIds: ['a'], points: 2, createdAt: now, updatedAt: now, revision: 0
};
const input: QuestionInput = {
  type: 'single', text: 'Question?',
  options: [{ optionId: 'a', text: 'A' }, { optionId: 'b', text: 'B' }],
  correctOptionIds: ['a'], points: 2
};

function setup() {
  const repository: jest.Mocked<QuestionRepository> = {
    quizExists: jest.fn(async () => true),
    findById: jest.fn(async () => record),
    create: jest.fn(async () => record),
    update: jest.fn(async () => record),
    delete: jest.fn(async () => true),
    insertMany: jest.fn(async (_id: string, batch: readonly QuestionInput[]) => batch.length),
    findByQuizCursor: jest.fn(() => Readable.from([record]))
  };
  return { repository, service: new QuestionService(repository) };
}

describe('QuestionService', () => {
  it('creates a question and returns a public DTO', async () => {
    const { repository, service } = setup();
    const result = await service.createQuestion(quizId, input);
    expect(repository.create).toHaveBeenCalledWith(quizId, input);
    expect(result).toMatchObject({ id: questionId, quizId, text: 'Question?', points: 2 });
    expect(result.createdAt).toBe(now.toISOString());
  });

  it('updates a question through the repository patch contract', async () => {
    const { repository, service } = setup();
    const patch: QuestionPatch = { points: 5 };
    const result = await service.updateQuestion(questionId, patch);
    expect(repository.update).toHaveBeenCalledWith(questionId, patch);
    expect(result.points).toBe(2);
  });

  it('returns not found when the update target does not exist', async () => {
    const { repository, service } = setup();
    repository.update.mockResolvedValue(null);
    await expect(service.updateQuestion(questionId, { text: 'Changed' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes a question and returns its ID', async () => {
    const { service } = setup();
    await expect(service.deleteQuestion(questionId)).resolves.toEqual({ questionId, deleted: true });
  });

  it('returns not found when deleting a missing question', async () => {
    const { repository, service } = setup();
    repository.delete.mockResolvedValue(false);
    await expect(service.deleteQuestion(questionId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('checks the quiz before reading import data', async () => {
    const { repository, service } = setup();
    repository.quizExists.mockResolvedValue(false);
    await expect(service.importQuestions(quizId, Readable.from([]))).rejects.toBeInstanceOf(NotFoundError);
    expect(repository.insertMany).not.toHaveBeenCalled();
  });

  it('imports through repository batches', async () => {
    const { repository, service } = setup();
    const ndjson = JSON.stringify(input);
    const report = await service.importQuestions(quizId, Readable.from([ndjson]));
    expect(repository.insertMany).toHaveBeenCalledTimes(1);
    expect(report.importedCount).toBe(1);
  });

  it('checks quiz existence before returning an export cursor', async () => {
    const { repository, service } = setup();
    await expect(service.questionExportCursor(quizId)).resolves.toBeInstanceOf(Readable);
    repository.quizExists.mockResolvedValue(false);
    await expect(service.questionExportCursor(quizId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
