import { describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import request from 'supertest';
import { ZodError } from 'zod';
import { createDashboardRouter } from './dashboard.routes.js';
import type { DashboardAuth } from './dashboard.ports.js';
import { makeDependencies, quizId, studentId } from './testing/fixtures.js';

class TestHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function makeApp() {
  const dependencies = makeDependencies();
  const requireRole = (role: string): RequestHandler => (req, _res, next) => {
    next(req.header('x-test-role') === role ? undefined : new TestHttpError(403, 'FORBIDDEN'));
  };
  const auth: DashboardAuth = {
    authenticate: (req, _res, next) => next(req.header('x-test-role') ? undefined : new TestHttpError(401, 'UNAUTHORIZED')),
    requireStudent: requireRole('student'), requireAdmin: requireRole('admin'),
    studentId: (_request: Request) => studentId
  };
  const app = express();
  app.use('/api/v1', createDashboardRouter(dependencies, auth));
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = error instanceof ZodError ? 400 : error instanceof TestHttpError ? error.status : 500;
    res.status(status).json({ success: false, error: { code: status === 400 ? 'VALIDATION_ERROR' : 'TEST_ERROR', message: 'Request failed' } });
  };
  app.use(errorHandler);
  return { app, dependencies };
}

describe('Dashboard HTTP component with test-only auth adapter', () => {
  it('returns canonical profile and KPI envelopes for a student', async () => {
    const { app } = makeApp();
    const response = await request(app).get('/api/v1/dashboard/me').set('x-test-role', 'student');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: {
      profile: { firstName: 'Mohammed', lastName: 'Student', avatarUrl: null },
      kpis: { quizzesPassed: 0, fastestTimeSeconds: null, totalCorrectAnswers: 0 }
    } });
  });

  it('rejects unauthenticated access before querying the repository', async () => {
    const { app, dependencies } = makeApp();
    const response = await request(app).get('/api/v1/dashboard/me');
    expect(response.status).toBe(401);
    expect(dependencies.profiles.findProfile).not.toHaveBeenCalled();
  });

  it('rejects a student on the admin analytics endpoint', async () => {
    const { app, dependencies } = makeApp();
    const response = await request(app).get(`/api/v1/admin/quizzes/${quizId}/analytics`).set('x-test-role', 'student');
    expect(response.status).toBe(403);
    expect(dependencies.analytics.execute).not.toHaveBeenCalled();
  });

  it('does not allow an admin to read a student-only dashboard', async () => {
    const response = await request(makeApp().app).get('/api/v1/dashboard/me').set('x-test-role', 'admin');
    expect(response.status).toBe(403);
  });

  it('uses the authenticated identity and rejects an injected studentId query', async () => {
    const { app, dependencies } = makeApp();
    const response = await request(app).get('/api/v1/dashboard/history?studentId=aaaaaaaaaaaaaaaaaaaaaaaa').set('x-test-role', 'student');
    expect(response.status).toBe(400);
    expect(dependencies.repository.getHistory).not.toHaveBeenCalled();
  });

  it('parses pagination and returns the standard metadata envelope', async () => {
    const { app, dependencies } = makeApp();
    const response = await request(app).get('/api/v1/dashboard/history?page=2&limit=5').set('x-test-role', 'student');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [], meta: { page: 2, limit: 5, total: 0, totalPages: 0 } });
    expect(dependencies.repository.getHistory).toHaveBeenCalledWith(studentId, { page: 2, limit: 5 });
  });

  it.each(['page=0', 'page=1.5', 'limit=101', 'limit=-1', 'page=hello', 'page=1&page=2'])('rejects invalid pagination %s', async query => {
    const response = await request(makeApp().app).get(`/api/v1/dashboard/history?${query}`).set('x-test-role', 'student');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('rejects an invalid quiz ID before controller execution', async () => {
    const { app, dependencies } = makeApp();
    const response = await request(app).get('/api/v1/admin/quizzes/invalid/analytics').set('x-test-role', 'admin');
    expect(response.status).toBe(400);
    expect(dependencies.quizzes.exists).not.toHaveBeenCalled();
  });

  it('rejects unsupported query input on the dashboard and analytics endpoints', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/api/v1/dashboard/me?extra=1').set('x-test-role', 'student')).status).toBe(400);
    expect((await request(app).get(`/api/v1/admin/quizzes/${quizId}/analytics?extra=1`).set('x-test-role', 'admin')).status).toBe(400);
  });

  it('lets an admin retrieve analytics through the shared executor', async () => {
    const response = await request(makeApp().app).get(`/api/v1/admin/quizzes/${quizId}/analytics`).set('x-test-role', 'admin');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { latency: { p50: null, p90: null } } });
  });

  it('delegates a profile error to the central handler', async () => {
    const { app, dependencies } = makeApp();
    jest.mocked(dependencies.profiles.findProfile).mockRejectedValue(new Error('private database detail'));
    const response = await request(app).get('/api/v1/dashboard/me').set('x-test-role', 'student');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('private database detail');
  });

  it('delegates history failure to the central handler', async () => {
    const { app, dependencies } = makeApp();
    jest.mocked(dependencies.repository.getHistory).mockRejectedValue(new Error('Database unavailable'));
    expect((await request(app).get('/api/v1/dashboard/history').set('x-test-role', 'student')).status).toBe(500);
  });

  it('delegates worker failure to the central handler', async () => {
    const { app, dependencies } = makeApp();
    jest.mocked(dependencies.analytics.execute).mockRejectedValue(new Error('Worker failed'));
    expect((await request(app).get(`/api/v1/admin/quizzes/${quizId}/analytics`).set('x-test-role', 'admin')).status).toBe(500);
  });
});
