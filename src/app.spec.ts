import { jest, describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { createApp } from './app.js';
import { createAuth, JwtVerifier } from './common/middlewares/auth-jwt.js';
import type { SessionReader } from './common/middlewares/auth-jwt.js';
import { makeDependencies, studentId } from './modules/dashboard/testing/fixtures.js';
import { validateRequest } from './common/middlewares/validate-request.js';
import { asyncHandler } from './common/middlewares/async-handler.js';
import { z } from 'zod';
import { AppError, ValidationError } from './common/errors/app-error.js';

const secret = 'test-secret-with-at-least-32-characters';
const key = new TextEncoder().encode(secret);
async function token(options: { secret?: string; role?: string; version?: number; expiry?: number; algorithm?: string } = {}) {
  return new SignJWT({ role: options.role ?? 'student', tokenVersion: options.version ?? 0 })
    .setProtectedHeader({ alg: options.algorithm ?? 'HS256' }).setSubject(studentId)
    .setExpirationTime(options.expiry ?? Math.floor(Date.now() / 1000) + 300)
    .sign(options.secret ? new TextEncoder().encode(options.secret) : key);
}
function setup(options: { dbReady?: boolean; workerReady?: boolean; trustProxy?: false | readonly string[] } = {}) {
  const sessions: SessionReader = { findSession: jest.fn<SessionReader['findSession']>().mockResolvedValue({ role: 'student', tokenVersion: 0 }) };
  const dashboard = makeDependencies();
  const reportError = jest.fn();
  const moduleRouter = express.Router();
  moduleRouter.post('/test-validation', validateRequest(z.object({ name: z.string() }).strict(), 'body'), (req, res) => {
    res.json({ parsed: res.locals.body, original: req.body });
  });
  moduleRouter.get('/test-failure', asyncHandler(async () => { throw new Error('private stack and data'); }));
  moduleRouter.get('/test-ip', (req, res) => { res.json({ ip: req.ip }); });
  moduleRouter.get('/test-private-error', (_req, _res, next) => next(new AppError(500, 'INTERNAL_ERROR', 'private-secret', [{ path: 'password', code: 'custom' }])));
  moduleRouter.get('/test-public-error', (_req, _res, next) => next(new ValidationError('Invalid request', [{ path: 'name', code: 'invalid_type' }])));
  moduleRouter.get('/test-dynamic-error', (_req, _res, next) => next(new AppError(409, 'CONFLICT', 'private-user@example.test')));
  moduleRouter.get('/test-dynamic-code', (_req, _res, next) => next(new AppError(500, 'private-user@example.test', 'private-context')));
  moduleRouter.get('/test-unknown-client-code', (_req, _res, next) => next(new AppError(400, 'private-value', 'private-context')));
  const app = createApp({
    auth: createAuth(new JwtVerifier(secret), sessions), dashboard, reportError,
    corsOrigins: ['http://localhost:5173'], moduleRouters: [moduleRouter], trustProxy: options.trustProxy ?? false,
    health: {
      dbReady: () => options.dbReady ?? true, workerReady: () => options.workerReady ?? true,
      uptime: () => 12, eventLoop: { snapshot: () => ({ meanDelayMs: 1, maxDelayMs: 2, p99DelayMs: 2 }) }
    }
  });
  return { app, sessions, dashboard, reportError };
}

describe('shared application and real JWT verification', () => {
  it.each([
    ['/test-dynamic-error', 409, 'CONFLICT', 'Resource conflict'],
    ['/test-dynamic-code', 500, 'INTERNAL_ERROR', 'Service temporarily unavailable'],
    ['/test-unknown-client-code', 400, 'REQUEST_ERROR', 'Request could not be completed']
  ])('never forwards arbitrary error messages or codes for %s', async (path, status, code, message) => {
    const response = await request(setup().app).get('/api/v1' + path);
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ success: false, error: { code, message, details: [] } });
    expect(JSON.stringify(response.body)).not.toContain('private');
  });
  it('ignores spoofed forwarding headers by default and honors configured proxy addresses', async () => {
    const untrusted = await request(setup().app).get('/api/v1/test-ip').set('X-Forwarded-For', '203.0.113.25');
    expect(untrusted.body.ip).not.toBe('203.0.113.25');
    const trusted = await request(setup({ trustProxy: ['127.0.0.1/8', '::1/128'] }).app).get('/api/v1/test-ip').set('X-Forwarded-For', '203.0.113.25');
    expect(trusted.body.ip).toBe('203.0.113.25');
  });
  it('hides internal AppError messages and details while reporting the failure', async () => {
    const { app, reportError } = setup();
    const response = await request(app).get('/api/v1/test-private-error');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Service temporarily unavailable', details: [] } });
    expect(reportError).toHaveBeenCalledTimes(1);
  });
  it('allows only the public error detail contract', async () => {
    const response = await request(setup().app).get('/api/v1/test-public-error');
    expect(response.body.error.details).toEqual([{ path: 'name', code: 'invalid_type', message: 'Invalid field value' }]);
  });
  it('exposes public health with the canonical envelope and security headers', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { status: 'ok', dbStatus: 'connected', uptimeSeconds: 12, workerStatus: 'ready' } });
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  it.each([{ dbReady: false }, { workerReady: false }])('returns degraded readiness when %j', async state => {
    const response = await request(setup(state).app).get('/api/v1/health');
    expect(response.status).toBe(503);
    expect(response.body.data.status).toBe('degraded');
  });
  it('allows the configured frontend origin and does not allow others', async () => {
    const { app } = setup();
    const allowed = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await request(app).get('/api/v1/health').set('Origin', 'https://unknown.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('checks a signed token and reads only its authenticated student', async () => {
    const { app, sessions, dashboard } = setup();
    const response = await request(app).get('/api/v1/dashboard/me').set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(200);
    expect(sessions.findSession).toHaveBeenCalledWith(studentId);
    expect(dashboard.repository.getKpis).toHaveBeenCalledWith(studentId);
  });
  it.each([
    { expiry: 1 }, { secret: 'another-key-with-at-least-32-characters' }, { algorithm: 'HS384' }
  ])('rejects expired or incorrectly signed tokens %j', async options => {
    const { app, dashboard } = setup();
    const response = await request(app).get('/api/v1/dashboard/me').set('Authorization', `Bearer ${await token(options)}`);
    expect(response.status).toBe(401);
    expect(dashboard.repository.getKpis).not.toHaveBeenCalled();
  });
  it.each(['', 'Bearer', 'Basic abc', 'Bearer abc def', 'Bearer invalid'])('rejects malformed authorization %j', async header => {
    const response = await request(setup().app).get('/api/v1/dashboard/me').set('Authorization', header);
    expect(response.status).toBe(401);
  });
  it('rejects a revoked tokenVersion', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/v1/dashboard/me').set('Authorization', `Bearer ${await token({ version: 1 })}`);
    expect(response.status).toBe(401);
  });
  it('rejects a deleted account', async () => {
    const { app, sessions } = setup();
    jest.mocked(sessions.findSession).mockResolvedValue(null);
    expect((await request(app).get('/api/v1/dashboard/me').set('Authorization', `Bearer ${await token()}`)).status).toBe(401);
  });
  it('rejects role changes since token issue', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/v1/dashboard/me').set('Authorization', `Bearer ${await token({ role: 'admin' })}`)).status).toBe(401);
  });
  it('forbids a valid student token on an admin route', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/v1/admin/quizzes/222222222222222222222222/analytics').set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(403);
  });
  it('delegates session database failures without disclosing them', async () => {
    const { app, sessions, reportError } = setup();
    jest.mocked(sessions.findSession).mockRejectedValue(new Error('database password'));
    const response = await request(app).get('/api/v1/dashboard/me').set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(reportError).toHaveBeenCalledTimes(1);
  });
  it('returns validation errors without echoing field values', async () => {
    const response = await request(setup().app).post('/api/v1/test-validation').send({ name: 12 });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: {
      code: 'VALIDATION_ERROR', message: 'Invalid request',
      details: [{ path: 'name', code: 'invalid_type', message: 'Invalid field value' }]
    } });
    expect(JSON.stringify(response.body)).not.toContain('12');
  });
  it('passes parsed data to handlers', async () => {
    const response = await request(setup().app).post('/api/v1/test-validation').send({ name: 'Mohammed' });
    expect(response.status).toBe(200);
    expect(response.body.parsed).toEqual({ name: 'Mohammed' });
  });
  it('returns a JSON error for malformed JSON', async () => {
    const response = await request(setup().app).post('/api/v1/test-validation').set('Content-Type', 'application/json').send('{');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('bounds JSON request body size', async () => {
    const response = await request(setup().app).post('/api/v1/test-validation').send({ name: 'x'.repeat(110_000) });
    expect(response.status).toBe(413);
  });
  it('catches async errors and hides internal details', async () => {
    const { app, reportError } = setup();
    const response = await request(app).get('/api/v1/test-failure');
    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe('An unexpected error occurred');
    expect(reportError).toHaveBeenCalledTimes(1);
  });
  it.each(['/unknown', '/api/v1/unknown'])('returns the shared not-found envelope for %s', async path => {
    const response = await request(setup().app).get(path);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND', details: [] } });
  });
  it('rate limits the API while keeping public health available', async () => {
    const { app } = setup();
    for (let index = 0; index < 300; index++) {
      await request(app).get('/api/v1/test-validation');
    }
    const response = await request(app).get('/api/v1/test-validation');
    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
  });
});
