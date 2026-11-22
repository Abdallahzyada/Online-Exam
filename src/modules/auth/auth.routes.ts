import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import type { Connection } from 'mongoose';

import { validateRequest } from '../../common/middlewares/validate-request.js';

import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyResetCodeSchema,
  resetPasswordSchema
} from './auth.dto.js';

import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import type { AuthEmailSender } from './auth.service.js';
import { AuthController } from './auth.controller.js';

interface AuthGuard {
  authenticate: RequestHandler;
  studentId(request: Request): string;
}

export interface AuthRouterDependencies {
  connection: Connection;
  collectionName: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  otpExpiresMinutes: number;
   authTokenSecret: string;
  auth: AuthGuard;
  emailSender: AuthEmailSender;
  reportError: (error: unknown) => void;
}

function createAuthRateLimit(limit: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Try again later.',
          details: []
        }
      });
    }
  });
}

export function createAuthRouter(
  dependencies: AuthRouterDependencies
): Router {
  const router = Router();

  const loginRateLimit = createAuthRateLimit(5);
const forgotPasswordRateLimit = createAuthRateLimit(3);
const verifyResetCodeRateLimit = createAuthRateLimit(5);
const resetPasswordRateLimit = createAuthRateLimit(5);

  const repository = new AuthRepository(
    dependencies.connection,
    dependencies.collectionName
  );

  const service = new AuthService(repository, {
    jwtSecret: dependencies.jwtSecret,
    jwtExpiresIn: dependencies.jwtExpiresIn,
    otpExpiresMinutes: dependencies.otpExpiresMinutes,
    authTokenSecret: dependencies.authTokenSecret,
    emailSender: dependencies.emailSender,
    reportError: dependencies.reportError
  });

  const controller = new AuthController(
    service,
    (request) => dependencies.auth.studentId(request)
  );

  router.post(
    '/auth/register',
    validateRequest(registerSchema, 'body', 'registerBody'),
    controller.register
  );

router.post(
  '/auth/login',
  loginRateLimit,
  validateRequest(loginSchema, 'body', 'loginBody'),
  controller.login
);

  router.post(
    '/auth/logout',
    dependencies.auth.authenticate,
    controller.logout
  );

 router.post(
  '/auth/forgot-password',
  forgotPasswordRateLimit,
  validateRequest(forgotPasswordSchema, 'body', 'forgotPasswordBody'),
  controller.forgotPassword
);

  router.post(
  '/auth/verify-reset-code',
  verifyResetCodeRateLimit,
  validateRequest(verifyResetCodeSchema, 'body', 'verifyResetCodeBody'),
  controller.verifyResetCode
);

  router.post(
  '/auth/reset-password',
  resetPasswordRateLimit,
  validateRequest(resetPasswordSchema, 'body', 'resetPasswordBody'),
  controller.resetPassword
);

  router.get(
    '/auth/me',
    dependencies.auth.authenticate,
    controller.me
  );

  return router;
}