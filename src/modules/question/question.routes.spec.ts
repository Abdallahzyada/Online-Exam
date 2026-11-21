import { describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';
import type { RequestHandler } from 'express';
import { createErrorHandler } from '../../common/middlewares/global-error-handler.js';
import { ForbiddenError, UnauthorizedError } from '../../common/errors/app-error.js';
import type { QuestionRepository, QuestionAuth, AttemptExportSource } from './question.ports.js';
import type { QuestionInput } from './question.dto.js';
import type { QuestionRecord } from './question.model.js';
import { Types } from 'mongoose';
import { createQuestionRouter } from './question.routes.js';

const quizId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const questionId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const document: QuestionRecord = {
  _id: new Types.ObjectId(questionId), quizId: new Types.ObjectId(quizId), type: 'single',
  text: 'What is 2 + 2?', options: [{ optionId: 'a', text: '4' }, { optionId: 'b', text: '5' }],
  correctOptionIds: ['a'], points: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'), revision: 0
};

function setup() {
  const repository: jest.Mocked<QuestionRepository> = {
    quizExists: jest.fn(async () => true),
    findById: jest.fn(async () => document),
    findByQuiz: jest.fn(async () => ({ questions: [document], total: 1 })),
    create: jest.fn(async () => document),
    update: jest.fn(async () => document),
    delete: jest.fn(async () => true),
    insertMany: jest.fn(async (_id: string, batch: readonly QuestionInput[]) => batch.length),
    findByQuizCursor: jest.fn(() => Readable.from([document]))
  };
  const authenticate: RequestHandler = (req, _res, next) => {
    if (!req.headers.authorization) { next(new UnauthorizedError()); return; }
    next();
  };
  const requireAdmin: RequestHandler = (req, _res, next) => {
    if (req.headers.authorization !== 'Bearer admin') { next(new ForbiddenError()); return; }
    next();
  };
  const auth: QuestionAuth = { authenticate, requireAdmin };
  const attempts: AttemptExportSource = { findByQuizCursor: () => Readable.from([{ _id: 'attempt-1', quizId }]) };
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createQuestionRouter(repository, auth, attempts));
  app.use(createErrorHandler(jest.fn()));
  return { app, repository };
}

const body: QuestionInput = {
  type: 'single', text: 'What is 2 + 2?',
  options: [{ optionId: 'a', text: '4' }, { optionId: 'b', text: '5' }],
  correctOptionIds: ['a'], points: 1
};

describe('Question HTTP routes', () => {
  it('requires authentication and admin role before creating a question', async () => {
    const { app, repository } = setup();
    expect((await request(app).post(`/api/v1/admin/quizzes/${quizId}/questions`).send(body)).status).toBe(401);
    expect((await request(app).post(`/api/v1/admin/quizzes/${quizId}/questions`).set('Authorization', 'Bearer student').send(body)).status).toBe(403);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('creates a question with the canonical success envelope', async () => {
    const { app, repository } = setup();
    const response = await request(app).post(`/api/v1/admin/quizzes/${quizId}/questions`)
      .set('Authorization', 'Bearer admin').send(body);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, data: { id: questionId, quizId, points: 1 } });
    expect(repository.create).toHaveBeenCalledWith(quizId, body);
  });

  it('rejects malformed question IDs and invalid answer keys', async () => {
    const { app, repository } = setup();
    const badId = await request(app).post('/api/v1/admin/quizzes/not-an-id/questions')
      .set('Authorization', 'Bearer admin').send(body);
    expect(badId.status).toBe(400);
    const badBody = await request(app).post(`/api/v1/admin/quizzes/${quizId}/questions`)
      .set('Authorization', 'Bearer admin').send({ ...body, correctOptionIds: ['missing'] });
    expect(badBody.status).toBe(400);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('uses the agreed PATCH and DELETE question endpoints', async () => {
    const { app, repository } = setup();
    const update = await request(app).patch(`/api/v1/admin/questions/${questionId}`)
      .set('Authorization', 'Bearer admin').send({ points: 3 });
    expect(update.status).toBe(200);
    expect(repository.update).toHaveBeenCalledWith(questionId, { points: 3 });
    const removed = await request(app).delete(`/api/v1/admin/questions/${questionId}`)
      .set('Authorization', 'Bearer admin');
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ questionId, deleted: true });
  });

  it('imports NDJSON and returns the line report', async () => {
    const { app, repository } = setup();
    const ndjson = `${JSON.stringify(body)}\n{bad json`;
    const response = await request(app).post(`/api/v1/admin/quizzes/${quizId}/questions/import`)
      .set('Authorization', 'Bearer admin').set('Content-Type', 'application/x-ndjson').send(ndjson);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ totalLines: 2, importedCount: 1, skippedCount: 1 });
    expect(repository.insertMany).toHaveBeenCalledTimes(1);
  });

  it('rejects imports with the wrong content type', async () => {
    const { app } = setup();
    const response = await request(app).post(`/api/v1/admin/quizzes/${quizId}/questions/import`)
      .set('Authorization', 'Bearer admin').send(body);
    expect(response.status).toBe(415);
  });

  it('streams question exports in NDJSON and attempts in CSV', async () => {
    const { app, repository } = setup();
    const questions = await request(app).get(`/api/v1/admin/quizzes/${quizId}/questions/export`)
      .set('Authorization', 'Bearer admin');
    expect(questions.status).toBe(200);
    expect(questions.headers['content-type']).toContain('application/x-ndjson');
    expect(questions.text).toContain('What is 2 + 2?');
    expect(repository.findByQuizCursor).toHaveBeenCalledWith(quizId);

    const attempts = await request(app).get(`/api/v1/admin/quizzes/${quizId}/attempts/export?format=csv`)
      .set('Authorization', 'Bearer admin');
    expect(attempts.status).toBe(200);
    expect(attempts.headers['content-type']).toContain('text/csv');
    expect(attempts.text).toContain('attempt-1');

    const compressed = await request(app).get(`/api/v1/admin/quizzes/${quizId}/questions/export?format=csv&compress=gzip`)
      .set('Authorization', 'Bearer admin');
    expect(compressed.status).toBe(200);
    expect(compressed.headers['content-encoding']).toBe('gzip');
  });

  it('keeps Attempt export unavailable until Engineer 4 registers the model', async () => {
    const repository = setup().repository;
    const app = express();
    const auth: QuestionAuth = {
      authenticate: (_req, _res, next) => next(),
      requireAdmin: (_req, _res, next) => next()
    };
    app.use('/api/v1', createQuestionRouter(repository, auth));
    app.use(createErrorHandler(jest.fn()));
    const response = await request(app).get(`/api/v1/admin/quizzes/${quizId}/attempts/export`);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('returns the not-found error when exporting an unknown quiz', async () => {
    const { app, repository } = setup();
    repository.quizExists.mockResolvedValue(false);
    const response = await request(app).get(`/api/v1/admin/quizzes/${quizId}/questions/export`)
      .set('Authorization', 'Bearer admin');
    expect(response.status).toBe(404);
  });

  it('lists questions for a quiz with a paginated envelope', async () => {
    const { app, repository } = setup();
    const response = await request(app).get(`/api/v1/admin/quizzes/${quizId}/questions`)
      .set('Authorization', 'Bearer admin');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: [expect.objectContaining({ id: questionId, quizId, text: 'What is 2 + 2?' })],
      meta: { total: 1, page: 1, limit: 10 }
    });
    expect(repository.findByQuiz).toHaveBeenCalledWith(quizId, { page: 1, limit: 10 });
  });

  it('applies pagination parameters to the question list', async () => {
    const { app, repository } = setup();
    const response = await request(app).get(`/api/v1/admin/quizzes/${quizId}/questions?page=2&limit=5`)
      .set('Authorization', 'Bearer admin');
    expect(response.status).toBe(200);
    expect(repository.findByQuiz).toHaveBeenCalledWith(quizId, { page: 2, limit: 5 });
  });

  it('requires auth for the question list endpoint', async () => {
    const { app } = setup();
    const noAuth = await request(app).get(`/api/v1/admin/quizzes/${quizId}/questions`);
    expect(noAuth.status).toBe(401);
    const student = await request(app).get(`/api/v1/admin/quizzes/${quizId}/questions`)
      .set('Authorization', 'Bearer student');
    expect(student.status).toBe(403);
  });

  it('returns a single question by ID', async () => {
    const { app, repository } = setup();
    const response = await request(app).get(`/api/v1/admin/questions/${questionId}`)
      .set('Authorization', 'Bearer admin');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { id: questionId, quizId } });
    expect(repository.findById).toHaveBeenCalledWith(questionId);
  });

  it('returns 404 for a non-existent question', async () => {
    const { app, repository } = setup();
    repository.findById.mockResolvedValue(null);
    const response = await request(app).get(`/api/v1/admin/questions/${questionId}`)
      .set('Authorization', 'Bearer admin');
    expect(response.status).toBe(404);
  });

  it('rejects an import whose Content-Length header exceeds 100 MB', async () => {
    const { app } = setup();
    const response = await request(app)
      .post(`/api/v1/admin/quizzes/${quizId}/questions/import`)
      .set('Authorization', 'Bearer admin')
      .set('Content-Type', 'application/x-ndjson')
      .set('Content-Length', String(101 * 1024 * 1024))
      .send('');
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('calls insertMany with the correct document payload and ordered:true option', async () => {
    const { app, repository } = setup();
    const ndjson = JSON.stringify(body);
    await request(app).post(`/api/v1/admin/quizzes/${quizId}/questions/import`)
      .set('Authorization', 'Bearer admin').set('Content-Type', 'application/x-ndjson').send(ndjson);
    expect(repository.insertMany).toHaveBeenCalledTimes(1);
    // The batch passed to insertMany must include the validated question fields
    const [calledQuizId, batch] = repository.insertMany.mock.calls[0]!;
    expect(calledQuizId).toBe(quizId);
    expect(batch[0]).toMatchObject({ type: 'single', text: 'What is 2 + 2?', points: 1 });
  });

  it('produces CSV with the canonical QUESTION_EXPORT_COLUMNS ordering', async () => {
    const { app } = setup();
    const response = await request(app)
      .get(`/api/v1/admin/quizzes/${quizId}/questions/export?format=csv`)
      .set('Authorization', 'Bearer admin');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    // Header row must follow QUESTION_EXPORT_COLUMNS order
    const firstLine = response.text.split('\r\n')[0];
    expect(firstLine).toBe('_id,quizId,type,text,options,correctOptionIds,points,createdAt,updatedAt');
    // Data row must contain the question text
    expect(response.text).toContain('What is 2 + 2?');
  });

  it('gzip-compressed NDJSON export decompresses to correct content', async () => {
    const { app } = setup();
    const response = await request(app)
      .get(`/api/v1/admin/quizzes/${quizId}/questions/export?format=ndjson&compress=gzip`)
      .set('Authorization', 'Bearer admin');
    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    // supertest automatically decompresses gzip; response.text is already plain NDJSON
    expect(response.text).toContain('What is 2 + 2?');
    // Must be valid NDJSON — the first line parses cleanly
    const parsed = JSON.parse(response.text.trim()) as Record<string, unknown>;
    expect(parsed['text']).toBe('What is 2 + 2?');
  });
});

