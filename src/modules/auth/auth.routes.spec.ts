
import { describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import { createConnection } from 'mongoose';
import request from 'supertest';

import { createErrorHandler } from '../../common/middlewares/global-error-handler.js';
import { createAuthRouter } from './auth.routes.js';

function makeApp() {
  const connection = createConnection();

  const app = express();
  app.use(express.json());

  app.use(
    '/api/v1',
    createAuthRouter({
      connection,
      collectionName: 'auth_rate_limit_test_users',
      jwtSecret: 'test-secret-with-at-least-32-characters',
      jwtExpiresIn: '15m',
      otpExpiresMinutes: 10,
      authTokenSecret: 'a'.repeat(64),
      auth: {
        authenticate: (_req, _res, next) => next(),
        studentId: () => 'student-id'
      },
      emailSender: {
        sendPasswordResetCode: jest.fn(async () => {})
      },
      reportError: jest.fn()
    })
  );

  app.use(createErrorHandler(jest.fn()));

  return app;
}

describe('Auth route rate limits', () => {
  it('limits login to 5 requests per 15 minutes', async () => {
    const app = makeApp();

    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({});
    }

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({});

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'RATE_LIMITED' }
    });
  });

  it('limits forgot-password to 3 requests per 15 minutes', async () => {
    const app = makeApp();

    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/v1/auth/forgot-password').send({});
    }

    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({});

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });

  it('limits reset-code verification to 5 requests per 15 minutes', async () => {
    const app = makeApp();

    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/verify-reset-code').send({});
    }

    const response = await request(app)
      .post('/api/v1/auth/verify-reset-code')
      .send({});

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });

  it('limits password reset to 5 requests per 15 minutes', async () => {
    const app = makeApp();

    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/reset-password').send({});
    }

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({});

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });
});
