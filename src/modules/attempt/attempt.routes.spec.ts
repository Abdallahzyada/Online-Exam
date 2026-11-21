import { describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import type { Request, RequestHandler } from 'express';
import request from 'supertest';
import { ForbiddenError, UnauthorizedError } from '../../common/errors/app-error.js';
import { createErrorHandler } from '../../common/middlewares/global-error-handler.js';
import { createAttemptRouter } from './attempt.routes.js';
import { AttemptService } from './attempt.service.js';
import type { AttemptAuth } from './attempt.ports.js';
import { makeHarness, otherStudentId, q1, q2, quizId, studentId } from './testing/fixtures.js';

// Test-only auth adapter; the real app uses the shared createAuth.
function makeApp() {
  const harness = makeHarness();
  const requireStudent: RequestHandler = (req, _res, next) => next(req.header('x-test-role') === 'student' ? undefined : new ForbiddenError());
  const auth: AttemptAuth = {
    authenticate: (req, _res, next) => next(req.header('x-test-role') ? undefined : new UnauthorizedError()),
    requireStudent,
    studentId: (req: Request) => req.header('x-test-student') ?? studentId
  };
  const report = jest.fn();
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createAttemptRouter(new AttemptService(harness.dependencies), auth));
  app.use(createErrorHandler(report));
  return { app, harness, report };
}
const answers = [{ questionId: q1, selectedOptionIds: ['opt_a'] }, { questionId: q2, selectedOptionIds: ['opt_a', 'opt_c'] }];

async function start(app: express.Express) {
  const response = await request(app).post(`/api/v1/quizzes/${quizId}/attempts`).set('x-test-role', 'student');
  return response.body.data.attemptId as string;
}

describe('Attempt HTTP routes', () => {
  it('starts an attempt with 201 and the success envelope, without answer keys', async () => {
    const { app } = makeApp();
    const response = await request(app).post(`/api/v1/quizzes/${quizId}/attempts`).set('x-test-role', 'student');
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, data: { quizTitle: 'Node Basics', durationMinutes: 15 } });
    expect(response.body.data.questions).toHaveLength(2);
    expect(JSON.stringify(response.body)).not.toContain('correctOptionIds');
  });

  it('submits with 200 and the score summary', async () => {
    const { app } = makeApp();
    const attemptId = await start(app);
    const response = await request(app).post(`/api/v1/attempts/${attemptId}/submit`).set('x-test-role', 'student').send({ answers });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: {
      attemptId, scorePercentage: 100, correctCount: 2, incorrectCount: 0, earnedPoints: 2, totalPoints: 2, passed: true, timeSpentSeconds: 0
    } });
  });

  it('returns 409 on double submit and the review after submission', async () => {
    const { app } = makeApp();
    const attemptId = await start(app);
    expect((await request(app).get(`/api/v1/attempts/${attemptId}/review`).set('x-test-role', 'student')).status).toBe(403);
    await request(app).post(`/api/v1/attempts/${attemptId}/submit`).set('x-test-role', 'student').send({ answers });
    const again = await request(app).post(`/api/v1/attempts/${attemptId}/submit`).set('x-test-role', 'student').send({ answers });
    expect(again.status).toBe(409);
    expect(again.body.success).toBe(false);
    const review = await request(app).get(`/api/v1/attempts/${attemptId}/review`).set('x-test-role', 'student');
    expect(review.status).toBe(200);
    expect(review.body.data.questions[0]).toMatchObject({ correctOptionIds: ['opt_a'], isCorrect: true });
  });

  it('returns 404 for another student\'s attempt', async () => {
    const { app } = makeApp();
    const attemptId = await start(app);
    const response = await request(app).get(`/api/v1/attempts/${attemptId}/review`)
      .set('x-test-role', 'student').set('x-test-student', otherStudentId);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('requires authentication and the student role', async () => {
    const { app, harness } = makeApp();
    expect((await request(app).post(`/api/v1/quizzes/${quizId}/attempts`)).status).toBe(401);
    expect((await request(app).post(`/api/v1/quizzes/${quizId}/attempts`).set('x-test-role', 'admin')).status).toBe(403);
    expect(harness.dependencies.quizzes.findQuiz).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid quiz ID', (app: express.Express) => request(app).post('/api/v1/quizzes/not-an-id/attempts')],
    ['an invalid attempt ID', (app: express.Express) => request(app).get('/api/v1/attempts/123/review')],
    ['an unexpected query field', (app: express.Express) => request(app).post(`/api/v1/quizzes/${quizId}/attempts?studentId=${otherStudentId}`)],
    ['a missing body', (app: express.Express) => request(app).post(`/api/v1/attempts/${quizId}/submit`)],
    ['a non-array selection', (app: express.Express) => request(app).post(`/api/v1/attempts/${quizId}/submit`).send({ answers: [{ questionId: q1, selectedOptionIds: 'opt_a' }] })],
    ['an unknown body field', (app: express.Express) => request(app).post(`/api/v1/attempts/${quizId}/submit`).send({ answers: [], score: 100 })]
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, send) => {
    const { app, harness } = makeApp();
    const response = await send(app).set('x-test-role', 'student');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(harness.dependencies.quizzes.findQuiz).not.toHaveBeenCalled();
  });

  it('reports which answer field is invalid without echoing values', async () => {
    const { app } = makeApp();
    const attemptId = await start(app);
    const response = await request(app).post(`/api/v1/attempts/${attemptId}/submit`).set('x-test-role', 'student')
      .send({ answers: [{ questionId: q1, selectedOptionIds: ['secret_option'] }] });
    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([{ path: 'answers.0.selectedOptionIds.0', code: 'custom', message: 'Invalid field value' }]);
    expect(JSON.stringify(response.body)).not.toContain('secret_option');
  });

  it('delegates unexpected failures to the central handler without leaking details', async () => {
    const { app, harness, report } = makeApp();
    jest.mocked(harness.dependencies.quizzes.findQuiz).mockRejectedValue(new Error('private database detail'));
    const response = await request(app).post(`/api/v1/quizzes/${quizId}/attempts`).set('x-test-role', 'student');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('private database detail');
    expect(report).toHaveBeenCalled();
  });
});
