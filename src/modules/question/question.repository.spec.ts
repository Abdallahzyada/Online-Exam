import { describe, expect, it, jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import type { QuestionRecord } from './question.model.js';
import type { QuestionInput } from './question.dto.js';
import { MongooseQuestionRepository } from './question.repository.js';

const quizId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const questionId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const now = new Date('2026-01-01T00:00:00.000Z');
const record: QuestionRecord = {
  _id: new Types.ObjectId(questionId), quizId: new Types.ObjectId(quizId), type: 'single', text: 'Question?',
  options: [{ optionId: 'a', text: 'A' }, { optionId: 'b', text: 'B' }],
  correctOptionIds: ['a'], points: 2, createdAt: now, updatedAt: now, revision: 0
};
const input: QuestionInput = {
  type: 'single', text: 'Question?', options: record.options,
  correctOptionIds: ['a'], points: 2
};

function queryResult<T>(value: T) {
  const query = {
    session: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn(async () => value)
  };
  return query;
}

function setup() {
  const session = {
    withTransaction: jest.fn(async (callback: () => Promise<unknown>) => await callback()),
    endSession: jest.fn(async () => undefined)
  };
  const quizzes = {
    findOne: jest.fn(async () => ({ _id: new Types.ObjectId(quizId) })),
    updateOne: jest.fn(async (_filter: unknown, _update: unknown, _options: unknown) => ({ matchedCount: 1 }))
  };
  const cursor = Readable.from([record], { objectMode: true });
  const questions = {
    findById: jest.fn((_id: unknown) => queryResult<QuestionRecord | null>(record)),
    create: jest.fn(async (_docs: unknown[], _options: unknown) => [{ toObject: () => record }]),
    findOneAndUpdate: jest.fn((_filter: unknown, _update: unknown, _options: unknown) => queryResult<QuestionRecord | null>(record)),
    deleteOne: jest.fn(async (_filter: unknown, _options: unknown) => ({ deletedCount: 1 })),
    insertMany: jest.fn(async (_docs: unknown[], _options: unknown) => [record]),
    find: jest.fn(() => ({ sort: () => ({ lean: () => ({ cursor: () => cursor }) }) }))
  };
  const connection = {
    collection: jest.fn(() => quizzes),
    startSession: jest.fn(async () => session)
  } as unknown as Connection;
  const repository = new MongooseQuestionRepository({
    connection, questions: questions as unknown as Model<QuestionRecord>, quizCollection: 'quizzes'
  });
  return { repository, questions, quizzes, session, cursor };
}

describe('MongooseQuestionRepository', () => {
  it('checks valid quiz IDs and safely rejects invalid IDs', async () => {
    const { repository, quizzes } = setup();
    await expect(repository.quizExists(quizId)).resolves.toBe(true);
    await expect(repository.quizExists('invalid')).resolves.toBe(false);
    expect(quizzes.findOne).toHaveBeenCalledTimes(1);
  });

  it('reads an existing question by ObjectId', async () => {
    const { repository } = setup();
    await expect(repository.findById(questionId)).resolves.toEqual(record);
    await expect(repository.findById('invalid')).resolves.toBeNull();
  });

  it('creates a question and increments both parent quiz counters in one transaction', async () => {
    const { repository, quizzes, session } = setup();
    await expect(repository.create(quizId, input)).resolves.toEqual(record);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(quizzes.updateOne).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId) }, { $inc: { questionsCount: 1, totalPoints: 2 } }, { session }
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('updates question fields and synchronizes the total points delta', async () => {
    const { repository, questions, quizzes } = setup();
    const updated = { ...record, points: 5, revision: 1 };
    questions.findOneAndUpdate.mockImplementation(() => queryResult<QuestionRecord | null>(updated));
    await repository.update(questionId, { points: 5 });
    expect(questions.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId), revision: 0 },
      { $set: { ...input, points: 5 }, $inc: { revision: 1 } },
      expect.objectContaining({ new: true, runValidators: true, session: expect.anything() })
    );
    expect(quizzes.updateOne).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId) }, { $inc: { questionsCount: 0, totalPoints: 3 } }, { session: expect.anything() }
    );
  });

  it('deletes the question and decrements parent quiz counters', async () => {
    const { repository, quizzes } = setup();
    await expect(repository.delete(questionId)).resolves.toBe(true);
    expect(quizzes.updateOne).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId) }, { $inc: { questionsCount: -1, totalPoints: -2 } }, { session: expect.anything() }
    );
  });

  it('returns false when the question does not exist on delete', async () => {
    const { repository, questions, quizzes } = setup();
    questions.findById.mockImplementation(() => queryResult<QuestionRecord | null>(null));
    await expect(repository.delete(questionId)).resolves.toBe(false);
    expect(quizzes.updateOne).not.toHaveBeenCalled();
  });

  it('bulk inserts a batch and increments counters once per batch', async () => {
    const { repository, questions, quizzes } = setup();
    await expect(repository.insertMany(quizId, [input, { ...input, points: 3 }])).resolves.toBe(2);
    expect(questions.insertMany).toHaveBeenCalledTimes(1);
    expect(quizzes.updateOne).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId) }, { $inc: { questionsCount: 2, totalPoints: 5 } }, { session: expect.anything() }
    );
  });

  it('does not open a transaction for an empty batch', async () => {
    const { repository } = setup();
    await expect(repository.insertMany(quizId, [])).resolves.toBe(0);
  });

  it('exposes an ordered Mongoose cursor for export', () => {
    const { repository, cursor } = setup();
    expect(repository.findByQuizCursor(quizId)).toBe(cursor);
  });
});
