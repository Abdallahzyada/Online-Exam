
import { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { jwtVerify } from 'jose';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { AuthService } from './auth.service.js';
import type { AuthEmailSender } from './auth.service.js';import type { AuthRepository } from './auth.repository.js';
import type { UserDocument, UserRecord } from './auth.model.js';
import type {
  RegisterDTO,
  LoginDTO,
  ForgotPasswordDTO,
  ResetPasswordDTO
} from './auth.dto.js';

import {
  ConflictError,
  UnauthorizedError
} from '../../common/errors/app-error.js';

const JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
const OTP_EXPIRY_MINUTES = 10;

function makeUser(overrides: Partial<UserRecord> = {}): UserDocument {
  const user = {
    _id: new Types.ObjectId(),
    firstName: 'Ayman',
    lastName: 'Mohamed',
    email: 'ayman@example.com',
    password: '$2b$12$test-hash',
    role: 'student' as const,
    tokenVersion: 0,
    resetOtpAttempts: 0,
    ...overrides
  };

  return user as unknown as UserDocument;
}

function makeRegisterDTO(): RegisterDTO {
  return {
    firstName: 'Ayman',
    lastName: 'Mohamed',
    email: 'ayman@example.com',
    password: 'StrongPass123!',
    confirmPassword: 'StrongPass123!'
  };
}

function makeLoginDTO(): LoginDTO {
  return {
    email: 'ayman@example.com',
    password: 'StrongPass123!'
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let repository: jest.Mocked<AuthRepository>;
  const sendPasswordResetCode = jest.fn(
  async (_email: string, _code: string): Promise<void> => {}
);

const emailSender: AuthEmailSender = {
  sendPasswordResetCode,
};
  let reportError: jest.Mock;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      incrementTokenVersion: jest.fn(),
      storeResetOtp: jest.fn(),
      findResetOtp: jest.fn(),
      recordFailedOtpAttempt: jest.fn(),
      markResetOtpVerified: jest.fn(),
      clearResetOtp: jest.fn(),
      resetPasswordWithOtp: jest.fn()
    } as unknown as jest.Mocked<AuthRepository>;

   sendPasswordResetCode.mockClear();
sendPasswordResetCode.mockResolvedValue(undefined);
    reportError = jest.fn();

    service = new AuthService(repository, {
      jwtSecret: JWT_SECRET,
      jwtExpiresIn: '15m',
      otpExpiresMinutes: OTP_EXPIRY_MINUTES,
      emailSender,
      reportError
    });
  });

  describe('register', () => {
    it('should register a new student and return a JWT', async () => {
      const dto = makeRegisterDTO();
      const user = makeUser();

      repository.findByEmail.mockResolvedValue(null);
      repository.create.mockResolvedValue(user);

      const result = await service.register(dto);

      expect(repository.findByEmail).toHaveBeenCalledWith(dto.email);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          role: 'student',
          tokenVersion: 0
        })
      );

      expect(result.accessToken).toBeDefined();
      expect(result.user).toEqual(
        expect.objectContaining({
          id: user._id.toString(),
          email: user.email,
          role: 'student'
        })
      );

      expect(result.user).not.toHaveProperty('password');
    });

    it('should hash the password before storing it', async () => {
      const dto = makeRegisterDTO();

      repository.findByEmail.mockResolvedValue(null);
      repository.create.mockImplementation(async (data) => {
        expect(data.password).not.toBe(dto.password);
        expect(await bcrypt.compare(dto.password, data.password)).toBe(true);
        return makeUser({ password: data.password });
      });

      await service.register(dto);

      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it('should reject duplicate email addresses', async () => {
      repository.findByEmail.mockResolvedValue(makeUser());

      await expect(
        service.register(makeRegisterDTO())
      ).rejects.toBeInstanceOf(ConflictError);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should handle a duplicate email race condition', async () => {
      repository.findByEmail.mockResolvedValue(null);

      repository.create.mockRejectedValue({
        code: 11000
      });

      await expect(
        service.register(makeRegisterDTO())
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('should never expose the password hash in the response', async () => {
      repository.findByEmail.mockResolvedValue(null);
      repository.create.mockResolvedValue(makeUser());

      const result = await service.register(makeRegisterDTO());

      expect(result.user).not.toHaveProperty('password');
    });
  });

  describe('login', () => {
    it('should reject an unknown email', async () => {
      repository.findByEmail.mockResolvedValue(null);

      await expect(
        service.login(makeLoginDTO())
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('should reject an incorrect password', async () => {
      const passwordHash = await bcrypt.hash('DifferentPass123!', 10);

      repository.findByEmail.mockResolvedValue(
        makeUser({ password: passwordHash })
      );

      await expect(
        service.login(makeLoginDTO())
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('should return a valid JWT for correct credentials', async () => {
      const passwordHash = await bcrypt.hash('StrongPass123!', 10);
      const user = makeUser({ password: passwordHash });

      repository.findByEmail.mockResolvedValue(user);

      const result = await service.login(makeLoginDTO());

      const verified = await jwtVerify(
        result.accessToken,
        new TextEncoder().encode(JWT_SECRET)
      );

      expect(verified.payload.sub).toBe(user._id.toString());
      expect(verified.payload.role).toBe('student');
      expect(verified.payload.tokenVersion).toBe(0);
    });

    it('should return a sanitized user DTO', async () => {
      const passwordHash = await bcrypt.hash('StrongPass123!', 10);

      repository.findByEmail.mockResolvedValue(
        makeUser({ password: passwordHash })
      );

      const result = await service.login(makeLoginDTO());

      expect(result.user).not.toHaveProperty('password');
      expect(result.user).not.toHaveProperty('resetOtpHash');
    });
  });

  describe('logout', () => {
    it('should increment the user token version', async () => {
      repository.incrementTokenVersion.mockResolvedValue(true);

      await service.logout('user-id');

      expect(repository.incrementTokenVersion).toHaveBeenCalledWith(
        'user-id'
      );
    });

    it('should reject logout if the user no longer exists', async () => {
      repository.incrementTokenVersion.mockResolvedValue(false);

      await expect(
        service.logout('missing-user')
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe('getMe', () => {
    it('should return the authenticated user profile', async () => {
      const user = makeUser();

      repository.findById.mockResolvedValue(user);

      const result = await service.getMe(user._id.toString());

      expect(result).toEqual(
        expect.objectContaining({
          id: user._id.toString(),
          email: user.email,
          firstName: user.firstName
        })
      );
    });

    it('should reject if the user does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.getMe('missing-user')
      ).rejects.toThrow();
    });
  });

  describe('forgotPassword', () => {
    it('should always return a generic message for unknown emails', async () => {
      repository.storeResetOtp.mockResolvedValue(false);

      const dto: ForgotPasswordDTO = {
        email: 'unknown@example.com'
      };

      const result = await service.forgotPassword(dto);

      expect(result).toContain('If an account exists');
      expect(emailSender.sendPasswordResetCode).not.toHaveBeenCalled();
    });

    it('should store an OTP hash and send the original code', async () => {
      repository.storeResetOtp.mockResolvedValue(true);

      const dto: ForgotPasswordDTO = {
        email: 'ayman@example.com'
      };

      await service.forgotPassword(dto);

      expect(repository.storeResetOtp).toHaveBeenCalledWith(
        dto.email,
        expect.any(String),
        expect.any(Date),
        expect.any(Date),
        expect.any(Number)
      );

   

      const storedHash = repository.storeResetOtp.mock.calls[0]?.[1];
      const sentCode = sendPasswordResetCode.mock.calls[0]?.[1];

      expect(storedHash).not.toBe(sentCode);
    });

    it('should return a generic response if email delivery fails', async () => {
      repository.storeResetOtp.mockResolvedValue(true);

     sendPasswordResetCode.mockRejectedValue(
  new Error('SMTP unavailable')
);

      const result = await service.forgotPassword({
        email: 'ayman@example.com'
      });

      expect(result).toContain('If an account exists');

      expect(repository.clearResetOtp).toHaveBeenCalledWith(
        'ayman@example.com',
        expect.any(String)
      );

      expect(reportError).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyResetCode', () => {
    it('should reject an unknown or missing OTP', async () => {
      repository.findResetOtp.mockResolvedValue(null);

      await expect(
        service.verifyResetCode({
          email: 'ayman@example.com',
          code: '123456'
        })
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('should reject an expired OTP', async () => {
      repository.findResetOtp.mockResolvedValue({
        hash: 'some-hash',
        expiresAt: new Date(Date.now() - 60_000),
        attempts: 0,
        verifiedAt: null
      });

      await expect(
        service.verifyResetCode({
          email: 'ayman@example.com',
          code: '123456'
        })
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('should reject OTP verification after the maximum attempts', async () => {
      repository.findResetOtp.mockResolvedValue({
        hash: 'some-hash',
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 5,
        verifiedAt: null
      });

      await expect(
        service.verifyResetCode({
          email: 'ayman@example.com',
          code: '123456'
        })
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('should reject an incorrect OTP and record a failed attempt', async () => {
      repository.findResetOtp.mockResolvedValue({
        hash: '0'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        verifiedAt: null
      });

      repository.recordFailedOtpAttempt.mockResolvedValue(1);

      await expect(
        service.verifyResetCode({
          email: 'ayman@example.com',
          code: '123456'
        })
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(repository.recordFailedOtpAttempt).toHaveBeenCalledWith(
        'ayman@example.com',
        '0'.repeat(64),
        5
      );
    });

    it('should mark a valid OTP as verified', async () => {
      const code = '123456';
      const { createHash } = await import('node:crypto');

      const hash = createHash('sha256').update(code).digest('hex');

      repository.findResetOtp.mockResolvedValue({
        hash,
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        verifiedAt: null
      });

      repository.markResetOtpVerified.mockResolvedValue(true);

      await service.verifyResetCode({
        email: 'ayman@example.com',
        code
      });

      expect(repository.markResetOtpVerified).toHaveBeenCalledWith(
        'ayman@example.com',
        hash,
        expect.any(Date),
        5
      );
    });

    it('should reject if the OTP was invalidated before verification completed', async () => {
      const { createHash } = await import('node:crypto');
      const code = '123456';

      const hash = createHash('sha256').update(code).digest('hex');

      repository.findResetOtp.mockResolvedValue({
        hash,
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        verifiedAt: null
      });

      repository.markResetOtpVerified.mockResolvedValue(false);

      await expect(
        service.verifyResetCode({
          email: 'ayman@example.com',
          code
        })
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe('resetPassword', () => {
    const dto: ResetPasswordDTO = {
      email: 'ayman@example.com',
      newPassword: 'NewStrongPass123!',
      confirmPassword: 'NewStrongPass123!'
    };

    it('should reject password reset before OTP verification', async () => {
      repository.resetPasswordWithOtp.mockResolvedValue(false);

      await expect(
        service.resetPassword(dto)
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('should update the password when the OTP was verified', async () => {
      repository.resetPasswordWithOtp.mockImplementation(
        async (_email, passwordHash) => {
          expect(
            await bcrypt.compare(dto.newPassword, passwordHash)
          ).toBe(true);

          return true;
        }
      );

      await service.resetPassword(dto);

      expect(repository.resetPasswordWithOtp).toHaveBeenCalledWith(
        dto.email,
        expect.any(String),
        expect.any(Date)
      );
    });

    it('should not allow the same verified OTP to be reused', async () => {
      // The repository's atomic update must consume the verified OTP.
      repository.resetPasswordWithOtp
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await service.resetPassword(dto);

      await expect(
        service.resetPassword(dto)
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(repository.resetPasswordWithOtp).toHaveBeenCalledTimes(2);
    });
  });
});
