import { describe, expect, it, jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { NotFoundError } from '../../common/errors/app-error.js';
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

/** Builds a fully chainable Mongoose query stub used by both findByQuiz and findByQuizCursor. */
function buildQueryChain(cursor: Readable, records: QuestionRecord[] = [record]) {
  const chain: Record<string, jest.Mock> = {};
  const self = () => chain;
  chain.sort = jest.fn(self);
  chain.skip = jest.fn(self);
  chain.limit = jest.fn(self);
  chain.maxTimeMS = jest.fn(self);
  chain.lean = jest.fn(self);
  chain.cursor = jest.fn(() => cursor);
  chain.exec = jest.fn(async () => records);
  return chain;
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
  const findChain = buildQueryChain(cursor);
  const questions = {
    findById: jest.fn((_id: unknown) => queryResult<QuestionRecord | null>(record)),
    create: jest.fn(async (_docs: unknown[], _options: unknown) => [{ toObject: () => record }]),
    findOneAndUpdate: jest.fn((_filter: unknown, _update: unknown, _options: unknown) => queryResult<QuestionRecord | null>(record)),
    deleteOne: jest.fn(async (_filter: unknown, _options: unknown) => ({ deletedCount: 1 })),
    insertMany: jest.fn(async (_docs: unknown[], _options: unknown) => [record]),
    countDocuments: jest.fn(async (_filter: unknown) => 1),
    find: jest.fn((_filter: unknown) => findChain)
  };
  const connection = {
    collection: jest.fn(() => quizzes),
    startSession: jest.fn(async () => session)
  } as unknown as Connection;
  const repository = new MongooseQuestionRepository({
    connection, questions: questions as unknown as Model<QuestionRecord>, quizCollection: 'quizzes'
  });
  return { repository, questions, quizzes, session, cursor, findChain };
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
    const { repository, questions, quizzes, session } = setup();
    await expect(repository.create(quizId, input)).resolves.toEqual(record);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    // Verify the document payload sent to the DB includes all input fields plus quizId
    expect(questions.create).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'single', text: 'Question?', points: 2, quizId: expect.any(Types.ObjectId) })],
      expect.objectContaining({ session })
    );
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
    const { repository, questions, quizzes } = setup();
    await expect(repository.delete(questionId)).resolves.toBe(true);
    // deleteOne must target the specific question ID and revision for optimistic concurrency
    expect(questions.deleteOne).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId), revision: 0 },
      expect.objectContaining({ session: expect.anything() })
    );
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

  it('returns paginated questions and total count from findByQuiz', async () => {
    const { repository, questions, findChain } = setup();
    const result = await repository.findByQuiz(quizId, { page: 2, limit: 5 });
    expect(result.total).toBe(1);
    expect(result.questions).toEqual([record]);
    // find must filter by the quiz's ObjectId
    expect(questions.find).toHaveBeenCalledWith({ quizId: expect.any(Types.ObjectId) });
    // must sort ascending by _id for stable pagination
    expect(findChain.sort).toHaveBeenCalledWith({ _id: 1 });
    // page 2 with limit 5 → skip 5
    expect(findChain.skip).toHaveBeenCalledWith(5);
    expect(findChain.limit).toHaveBeenCalledWith(5);
    expect(questions.countDocuments).toHaveBeenCalledWith({ quizId: expect.any(Types.ObjectId) });
  });

  it('bulk inserts a batch without opening a transaction (standalone-compatible)', async () => {
    const { repository, questions, quizzes, session } = setup();
    await expect(repository.insertMany(quizId, [input, { ...input, points: 3 }])).resolves.toBe(2);
    // Must NOT use a session — that would require a replica set
    expect(session.withTransaction).not.toHaveBeenCalled();
    expect(questions.insertMany).toHaveBeenCalledTimes(1);
    expect(questions.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: 'single', quizId: expect.any(Types.ObjectId) })
      ]),
      { ordered: true }  // no session option
    );
    // Counter update must be session-free: third arg is an empty options object
    expect(quizzes.updateOne).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId) },
      { $inc: { questionsCount: 2, totalPoints: 5 } },
      {}  // no session key — compatible with MongoDB Standalone
    );
  });

  it('propagates a DB error from insertMany without swallowing it as a validation skip', async () => {
    const { repository, questions } = setup();
    const dbError = new Error('Write conflict');
    questions.insertMany.mockRejectedValue(dbError);
    await expect(repository.insertMany(quizId, [input])).rejects.toThrow('Write conflict');
  });

  it('propagates a counter-update failure after a successful insert', async () => {
    const { repository, quizzes } = setup();
    quizzes.updateOne.mockResolvedValue({ matchedCount: 0 });
    // The insert succeeds but the counter update fails → the error must surface
    await expect(repository.insertMany(quizId, [input])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('does not open a transaction for an empty batch', async () => {
    const { repository, session } = setup();
    await expect(repository.insertMany(quizId, [])).resolves.toBe(0);
    expect(session.withTransaction).not.toHaveBeenCalled();
  });

  it('exposes a cursor that filters by quizId, sorts by _id, and applies a 30-second timeout', () => {
    const { repository, questions, findChain, cursor } = setup();
    const result = repository.findByQuizCursor(quizId);
    expect(result).toBe(cursor);
    expect(questions.find).toHaveBeenCalledWith({ quizId: expect.any(Types.ObjectId) });
    expect(findChain.sort).toHaveBeenCalledWith({ _id: 1 });
    expect(findChain.maxTimeMS).toHaveBeenCalledWith(30_000);
  });
});
