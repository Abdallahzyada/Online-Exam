import type { NextFunction, Request, Response } from 'express';

import { success } from '../../common/utils/response-envelope.js';

import type {
  RegisterDTO,
  LoginDTO,
  ForgotPasswordDTO,
  VerifyResetCodeDTO,
  ResetPasswordDTO
} from './auth.dto.js';

import type { AuthService } from './auth.service.js';

export interface AuthLocals {
  registerBody?: RegisterDTO;
  loginBody?: LoginDTO;
  forgotPasswordBody?: ForgotPasswordDTO;
  verifyResetCodeBody?: VerifyResetCodeDTO;
  resetPasswordBody?: ResetPasswordDTO;
}

type AuthResponse = Response<unknown, AuthLocals>;

export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly getUserId: (request: Request) => string
  ) {}

  register = async (
    _req: Request,
    res: AuthResponse,
    next: NextFunction
  ): Promise<void> => {
    try {
      const dto = res.locals.registerBody;

      if (!dto) throw new Error('Registration validation middleware is missing');

      const result = await this.service.register(dto);

      res.status(201).json(success(result));
    } catch (error: unknown) {
      next(error);
    }
  };

  login = async (
    _req: Request,
    res: AuthResponse,
    next: NextFunction
  ): Promise<void> => {
    try {
      const dto = res.locals.loginBody;

      if (!dto) throw new Error('Login validation middleware is missing');

      const result = await this.service.login(dto);

      res.status(200).json(success(result));
    } catch (error: unknown) {
      next(error);
    }
  };

  logout = async (
    req: Request,
    res: AuthResponse,
    next: NextFunction
  ): Promise<void> => {
    try {
      await this.service.logout(this.getUserId(req));

      res.status(200).json(success({ message: 'Logged out successfully' }));
    } catch (error: unknown) {
      next(error);
    }
  };

  forgotPassword = async (
    _req: Request,
    res: AuthResponse,
    next: NextFunction
  ): Promise<void> => {
    try {
      const dto = res.locals.forgotPasswordBody;

      if (!dto) throw new Error('Forgot-password validation middleware is missing');

      const message = await this.service.forgotPassword(dto);

      res.status(200).json(success({ message }));
    } catch (error: unknown) {
      next(error);
    }
  };

  verifyResetCode = async (
    _req: Request,
    res: AuthResponse,
    next: NextFunction
  ): Promise<void> => {
    try {
      const dto = res.locals.verifyResetCodeBody;

      if (!dto) throw new Error('OTP validation middleware is missing');

      const result = await this.service.verifyResetCode(dto);

res.status(200).json(
  success({
    message: 'Code verified successfully',
    resetToken: result.resetToken
  })
);
    } catch (error: unknown) {
      next(error);
    }
  };

  resetPassword = async (
    _req: Request,
    res: AuthResponse,
    next: NextFunction
  ): Promise<void> => {
    try {
      const dto = res.locals.resetPasswordBody;

      if (!dto) throw new Error('Password validation middleware is missing');

      await this.service.resetPassword(dto);

      res.status(200).json(
        success({ message: 'Password reset successfully' })
      );
    } catch (error: unknown) {
      next(error);
    }
  };

  me = async (
    req: Request,
    res: AuthResponse,
    next: NextFunction
  ): Promise<void> => {
    try {
      const user = await this.service.getMe(this.getUserId(req));

      res.status(200).json(success(user));
    } catch (error: unknown) {
      next(error);
    }
  };
}