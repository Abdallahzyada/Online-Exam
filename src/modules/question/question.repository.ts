import { Types } from 'mongoose';
import type { ClientSession, Collection, Connection, Model } from 'mongoose';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { questionSchema } from './question.dto.js';
import type { QuestionInput, QuestionPatch } from './question.dto.js';
import type { QuestionRepository } from './question.ports.js';
import type { QuestionRecord } from './question.model.js';

export interface MongooseQuestionRepositoryOptions {
  readonly connection: Connection;
  readonly questions: Model<QuestionRecord>;
  readonly quizCollection: string;
}

export class MongooseQuestionRepository implements QuestionRepository {
  private readonly quizzes: Collection;

  constructor(private readonly options: MongooseQuestionRepositoryOptions) {
    this.quizzes = options.connection.collection(options.quizCollection);
  }

  async quizExists(quizId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(quizId)) return false;
    const quiz = await this.quizzes.findOne({ _id: new Types.ObjectId(quizId) }, { projection: { _id: 1 } });
    return quiz !== null;
  }

  async findById(questionId: string): Promise<QuestionRecord | null> {
    if (!Types.ObjectId.isValid(questionId)) return null;
    return await this.options.questions.findById(new Types.ObjectId(questionId)).lean<QuestionRecord>().exec();
  }

  async create(quizId: string, input: QuestionInput): Promise<QuestionRecord> {
    const quizObjectId = this.asObjectId(quizId);
    return await this.withTransaction(async session => {
      await this.assertQuizExists(quizObjectId, session);
      const [created] = await this.options.questions.create([{ ...input, quizId: quizObjectId }], { session });
      if (!created) throw new Error('Question insert returned no document');
      await this.incrementQuizCounters(quizObjectId, 1, input.points, session);
      return created.toObject() as QuestionRecord;
    });
  }

  async update(questionId: string, patch: QuestionPatch): Promise<QuestionRecord | null> {
    const objectId = this.asObjectId(questionId);
    return await this.withTransaction(async session => {
      const current = await this.options.questions.findById(objectId).session(session).lean<QuestionRecord>().exec();
      if (!current) throw new NotFoundError('Question');
      await this.assertQuizExists(current.quizId, session);
      const input = questionSchema.parse({
        type: current.type, text: current.text, options: current.options,
        correctOptionIds: current.correctOptionIds, points: current.points, ...patch
      });
      const updated = await this.options.questions.findOneAndUpdate(
        { _id: objectId, revision: current.revision },
        { $set: input, $inc: { revision: 1 } },
        { new: true, runValidators: true, session }
      ).lean<QuestionRecord>().exec();
      if (!updated) throw new ConflictError('Question changed during this update. Reload and try again.');
      const delta = input.points - current.points;
      if (delta !== 0) await this.incrementQuizCounters(current.quizId, 0, delta, session);
      return updated;
    });
  }

  async delete(questionId: string): Promise<boolean> {
    const objectId = this.asObjectId(questionId);
    return await this.withTransaction(async session => {
      const current = await this.options.questions.findById(objectId).session(session).lean<QuestionRecord>().exec();
      if (!current) return false;
      const deleted = await this.options.questions.deleteOne({ _id: objectId, revision: current.revision }, { session });
      if (deleted.deletedCount !== 1) throw new ConflictError('Question changed during deletion. Reload and try again.');
      await this.incrementQuizCounters(current.quizId, -1, -current.points, session);
      return true;
    });
  }

  async insertMany(quizId: string, questions: readonly QuestionInput[]): Promise<number> {
    if (questions.length === 0) return 0;
    const quizObjectId = this.asObjectId(quizId);
    return await this.withTransaction(async session => {
      await this.assertQuizExists(quizObjectId, session);
      await this.options.questions.insertMany(
        questions.map(question => ({ ...question, quizId: quizObjectId })),
        { session, ordered: true }
      );
      const totalPoints = questions.reduce((total, question) => total + question.points, 0);
      await this.incrementQuizCounters(quizObjectId, questions.length, totalPoints, session);
      return questions.length;
    });
  }

  findByQuizCursor(quizId: string) {
    return this.options.questions.find({ quizId: this.asObjectId(quizId) })
      .sort({ _id: 1 }).lean().cursor({ batchSize: 100 });
  }

  private asObjectId(value: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw new NotFoundError('Resource');
    return new Types.ObjectId(value);
  }

  private async assertQuizExists(quizId: Types.ObjectId, session: ClientSession): Promise<void> {
    const quiz = await this.quizzes.findOne({ _id: quizId }, { session, projection: { _id: 1 } });
    if (!quiz) throw new NotFoundError('Quiz');
  }

  private async incrementQuizCounters(
    quizId: Types.ObjectId,
    questionsCount: number,
    totalPoints: number,
    session: ClientSession
  ): Promise<void> {
    const result = await this.quizzes.updateOne(
      { _id: quizId },
      { $inc: { questionsCount, totalPoints } },
      { session }
    );
    if (result.matchedCount !== 1) throw new NotFoundError('Quiz');
  }

  private async withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.options.connection.startSession();
    let result: T | undefined;
    try {
      await session.withTransaction(async () => { result = await work(session); });
      if (result === undefined) throw new Error('Database transaction did not complete');
      return result;
    } finally {
      await session.endSession();
    }
  }
}
