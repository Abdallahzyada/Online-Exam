import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import express from 'express';
import type { Request } from 'express';
import mongoose, { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../common/errors/app-error.js';
import { createErrorHandler } from '../../common/middlewares/global-error-handler.js';
import { MongooseDashboardRepository } from '../dashboard/dashboard.repository.js';
import { analyticsAttemptSchema } from '../dashboard/dashboard.dto.js';
import { createAttemptModule } from './attempt.module.js';
import type { AttemptModule } from './attempt.module.js';
import { ATTEMPT_EXPIRY_INDEX } from './attempt.model.js';
import { createAttemptCatalogReaders } from './attempt.catalog-adapter.js';
import { testMongoBaseUri, temporaryMongoUri } from '../../config/test-database-uri.js';

// Live MongoDB checks. Set ATTEMPT_TEST_MONGO_URI to point elsewhere; skipped when
// no server answers. Each run uses and drops its own temporary database.
const baseUri = testMongoBaseUri(process.env.ATTEMPT_TEST_MONGO_URI);
async function reachable(): Promise<boolean> {
  const probe = mongoose.createConnection(baseUri, { serverSelectionTimeoutMS: 1500 });
  try { await probe.asPromise(); return true; } catch { return false; } finally { await probe.close().catch(() => undefined); }
}
const live = await reachable();
const suite = live ? describe : describe.skip;

const oid = () => new Types.ObjectId();
const student = oid(), otherStudent = oid();
const quiz = oid(), draftQuiz = oid(), emptyQuiz = oid(), brokenQuiz = oid(), archivedQuiz = oid(), largeQuiz = oid();
const qSingle = oid(), qMulti = oid(), qBroken = oid();

suite('Attempts against live MongoDB', () => {
  let connection: Connection;
  let attempts: AttemptModule;
  const clock = { now: new Date('2026-11-21T10:00:00.000Z') };
  const report = jest.fn();
  let app: express.Express;

  beforeAll(async () => {
    connection = mongoose.createConnection(temporaryMongoUri(baseUri, `online_exam_attempt_${randomBytes(6).toString('hex')}`));
    await connection.asPromise();
    await connection.collection('quizzes').insertMany([
      { _id: quiz, title: 'Live Quiz', imageUrl: 'https://example.com/q.png', durationMinutes: 15, passingScorePercentage: 50, isPublished: true },
      { _id: draftQuiz, title: 'Draft', durationMinutes: 15, isPublished: false },
      { _id: emptyQuiz, title: 'Empty', durationMinutes: 15, isPublished: true },
      { _id: brokenQuiz, title: 'Broken', durationMinutes: 15, isPublished: true },
      { _id: archivedQuiz, title: 'Archived', durationMinutes: 15, isPublished: true, isArchived: true },
      { _id: largeQuiz, title: 'Largest allowed', durationMinutes: 15, isPublished: true, isArchived: false }
    ]);
    await connection.collection('questions').insertMany([
      { _id: qSingle, quizId: quiz, type: 'single', text: 'Pick A', points: 2,
        options: [{ optionId: 'opt_a', text: 'A' }, { optionId: 'opt_b', text: 'B' }], correctOptionIds: ['opt_a'] },
      { _id: qMulti, quizId: quiz, type: 'multi', text: 'Pick A and C',
        options: [{ optionId: 'opt_a', text: 'A' }, { optionId: 'opt_b', text: 'B' }, { optionId: 'opt_c', text: 'C' }], correctOptionIds: ['opt_a', 'opt_c'] },
      { _id: qBroken, quizId: brokenQuiz, type: 'single', text: 'Bad key',
        options: [{ optionId: 'opt_a', text: 'A' }, { optionId: 'opt_b', text: 'B' }], correctOptionIds: ['opt_a', 'opt_b'] },
      // The largest question the Question Bank DTO accepts must still be snapshotted.
      { _id: oid(), quizId: largeQuiz, type: 'multi', text: 'q'.repeat(10_000), points: 1_000_000,
        options: Array.from({ length: 100 }, (_, index) => ({ optionId: `o${index}`.padEnd(64, 'x'), text: 't'.repeat(2_000) })),
        correctOptionIds: Array.from({ length: 100 }, (_, index) => `o${index}`.padEnd(64, 'x')) }
    ]);
    attempts = createAttemptModule({
      connection, report, now: () => clock.now,
      collections: { attempts: 'quizattempts', quizzes: 'quizzes' },
      auth: {
        authenticate: (req, _res, next) => next(req.header('x-student') ? undefined : new UnauthorizedError()),
        requireStudent: (req, _res, next) => next(req.header('x-role') === 'admin' ? new ForbiddenError() : undefined),
        studentId: (req: Request) => req.header('x-student') ?? ''
      }
    });
    await attempts.ensureIndexes();
    app = express();
    app.use(express.json());
    app.use('/api/v1', attempts.router);
    app.use(createErrorHandler(report));
  });

  afterAll(async () => {
    await attempts?.stop();
    await connection?.dropDatabase();
    await connection?.close();
  });

  const as = (studentId: Types.ObjectId) => ({ 'x-student': studentId.toHexString() });
  const startAttempt = async (studentId = student) => {
    const response = await request(app).post(`/api/v1/quizzes/${quiz.toHexString()}/attempts`).set(as(studentId));
    expect(response.status).toBe(201);
    return response.body.data as { attemptId: string; expiresAt: string; questions: { questionId: string }[] };
  };
  const answers = [
    { questionId: qSingle.toHexString(), selectedOptionIds: ['opt_a'] },
    { questionId: qMulti.toHexString(), selectedOptionIds: ['opt_c', 'opt_a', 'opt_a'] }
  ];

  it('creates the expiry index', async () => {
    const indexes = await connection.collection('quizattempts').listIndexes().toArray();
    expect(indexes.some(index => index.name === ATTEMPT_EXPIRY_INDEX)).toBe(true);
  });

  it('starts, submits and reviews an attempt end to end', async () => {
    const started = await startAttempt();
    expect(started.questions.map(question => question.questionId)).toEqual([qSingle.toHexString(), qMulti.toHexString()]);
    expect(JSON.stringify(started)).not.toContain('correctOptionIds');
    clock.now = new Date(clock.now.getTime() + 90_000);
    const submitted = await request(app).post(`/api/v1/attempts/${started.attemptId}/submit`).set(as(student)).send({ answers });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data).toMatchObject({ scorePercentage: 100, earnedPoints: 3, totalPoints: 3, passed: true, timeSpentSeconds: 90 });
    const review = await request(app).get(`/api/v1/attempts/${started.attemptId}/review`).set(as(student));
    expect(review.status).toBe(200);
    expect(review.body.data.questions[1]).toMatchObject({ selectedOptionIds: ['opt_c', 'opt_a'], correctOptionIds: ['opt_a', 'opt_c'], isCorrect: true, pointsEarned: 1 });
  });

  it('lets only one of many parallel submissions score (BR-12)', async () => {
    const { attemptId } = await startAttempt();
    const responses = await Promise.all(Array.from({ length: 5 }, () =>
      request(app).post(`/api/v1/attempts/${attemptId}/submit`).set(as(student)).send({ answers })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409, 409, 409, 409]);
    const stored = await connection.collection('quizattempts').findOne({ _id: new Types.ObjectId(attemptId) });
    expect(stored).toMatchObject({ status: 'SUBMITTED', scorePercentage: 100 });
  });

  it('stores a late submission as EXPIRED and returns 400', async () => {
    const { attemptId } = await startAttempt();
    clock.now = new Date(clock.now.getTime() + 15 * 60_000 + 15_000);
    const response = await request(app).post(`/api/v1/attempts/${attemptId}/submit`).set(as(student)).send({ answers });
    expect(response.status).toBe(400);
    const stored = await connection.collection('quizattempts').findOne({ _id: new Types.ObjectId(attemptId) });
    expect(stored).toMatchObject({ status: 'EXPIRED', scorePercentage: 0, passed: false, timeSpentSeconds: 900 });
  });

  it('hides other students\' attempts, drafts and missing quizzes with 404', async () => {
    const { attemptId } = await startAttempt();
    expect((await request(app).get(`/api/v1/attempts/${attemptId}/review`).set(as(otherStudent))).status).toBe(404);
    expect((await request(app).post(`/api/v1/attempts/${attemptId}/submit`).set(as(otherStudent)).send({ answers })).status).toBe(404);
    expect((await request(app).post(`/api/v1/quizzes/${draftQuiz.toHexString()}/attempts`).set(as(student))).status).toBe(404);
    expect((await request(app).post(`/api/v1/quizzes/${oid().toHexString()}/attempts`).set(as(student))).status).toBe(404);
    expect((await request(app).post(`/api/v1/quizzes/${emptyQuiz.toHexString()}/attempts`).set(as(student))).status).toBe(409);
    expect((await request(app).post(`/api/v1/quizzes/${archivedQuiz.toHexString()}/attempts`).set(as(student))).status).toBe(404);
  });

  it('snapshots the largest question the Question Bank accepts (10,000 chars, 100 options)', async () => {
    const response = await request(app).post(`/api/v1/quizzes/${largeQuiz.toHexString()}/attempts`).set(as(otherStudent));
    expect(response.status).toBe(201);
    expect(response.body.data.questions[0].options).toHaveLength(100);
    expect(response.body.data.questions[0].text).toHaveLength(10_000);
  });

  it('rejects a stored question that breaks the answer-key rules (BR-08) with a safe 500', async () => {
    const response = await request(app).post(`/api/v1/quizzes/${brokenQuiz.toHexString()}/attempts`).set(as(student));
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('Stored question');
  });

  it('expires abandoned attempts in one server-side update, including stale claims', async () => {
    const abandoned = await startAttempt();
    const stuck = await startAttempt();
    await connection.collection('quizattempts').updateOne({ _id: new Types.ObjectId(stuck.attemptId) }, { $set: { status: 'SUBMITTING' } });
    const fresh = await startAttempt();
    clock.now = new Date(clock.now.getTime() + 15 * 60_000 + 11_000);
    attempts.startBackgroundJobs();
    await attempts.stop();
    const byId = async (id: string) => connection.collection('quizattempts').findOne({ _id: new Types.ObjectId(id) });
    expect(await byId(abandoned.attemptId)).toMatchObject({
      status: 'EXPIRED', scorePercentage: 0, passed: false, correctCount: 0, incorrectCount: 2, earnedPoints: 0,
      totalPoints: 3, timeSpentSeconds: 900, answers: [], submittedAt: clock.now,
      questionResults: [{ questionId: qSingle.toHexString(), isCorrect: false }, { questionId: qMulti.toHexString(), isCorrect: false }]
    });
    expect((await byId(stuck.attemptId))?.status).toBe('SUBMITTING');
    clock.now = new Date(clock.now.getTime() + 61_000);
    attempts.startBackgroundJobs();
    await attempts.stop();
    expect((await byId(stuck.attemptId))?.status).toBe('EXPIRED');
    expect((await byId(fresh.attemptId))?.status).toBe('EXPIRED');
  });

  it('is readable by the Dashboard repository and analytics contract unchanged', async () => {
    const dashboard = new MongooseDashboardRepository({
      connection, attemptCollection: 'quizattempts',
      errors: { notFound: () => new NotFoundError(), analyticsLimit: () => new Error('limit') }
    });
    const kpis = await dashboard.getKpis(student.toHexString());
    expect(kpis).toEqual({ quizzesPassed: 2, fastestTimeSeconds: 0, totalCorrectAnswers: 4 });
    const history = await dashboard.getHistory(student.toHexString(), { page: 1, limit: 100 });
    expect(history.total).toBeGreaterThanOrEqual(5);
    expect(history.entries[0]).toEqual(expect.objectContaining({
      quizId: quiz.toHexString(), quizTitle: 'Live Quiz', quizImageUrl: 'https://example.com/q.png',
      questionsCount: 2, durationMinutes: 15, passed: false
    }));
    expect(JSON.stringify(history.entries)).not.toContain('correctOptionIds');
    const analytics = await dashboard.getAnalyticsAttempts(quiz.toHexString());
    expect(analytics).toHaveLength(2);
    for (const attempt of analytics) expect(analyticsAttemptSchema.safeParse(attempt).success).toBe(true);
  });

  it('reports a stored quiz that breaks the shared contract', async () => {
    const readers = createAttemptCatalogReaders(connection, { quizzes: 'quizzes', questions: 'questions' });
    const bad = oid();
    await connection.collection('quizzes').insertOne({ _id: bad, title: 42 });
    await expect(readers.quizzes.findQuiz(bad.toHexString())).rejects.toThrow('Stored quiz does not match');
  });
});
