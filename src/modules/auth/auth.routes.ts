import { Router } from 'express';
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
  auth: AuthGuard;
  emailSender: AuthEmailSender;
  reportError: (error: unknown) => void;
}

export function createAuthRouter(
  dependencies: AuthRouterDependencies
): Router {
  const router = Router();

  const repository = new AuthRepository(
    dependencies.connection,
    dependencies.collectionName
  );

  const service = new AuthService(repository, {
    jwtSecret: dependencies.jwtSecret,
    jwtExpiresIn: dependencies.jwtExpiresIn,
    otpExpiresMinutes: dependencies.otpExpiresMinutes,
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
    validateRequest(forgotPasswordSchema, 'body', 'forgotPasswordBody'),
    controller.forgotPassword
  );

  router.post(
    '/auth/verify-reset-code',
    validateRequest(verifyResetCodeSchema, 'body', 'verifyResetCodeBody'),
    controller.verifyResetCode
  );

  router.post(
    '/auth/reset-password',
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