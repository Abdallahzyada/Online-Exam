import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual
} from 'node:crypto';
import bcrypt from 'bcrypt';
import { SignJWT } from 'jose';

import {
  ConflictError,
  NotFoundError,
  UnauthorizedError
} from '../../common/errors/app-error.js';

import type {
  RegisterDTO,
  LoginDTO,
  ForgotPasswordDTO,
  VerifyResetCodeDTO,
  ResetPasswordDTO,
  AuthUserDTO,
  AuthTokenResponse
} from './auth.dto.js';

import type { UserDocument } from './auth.model.js';
import type { AuthRepository } from './auth.repository.js';

export interface AuthEmailSender {
  sendPasswordResetCode(email: string, code: string): Promise<void>;
}

export interface AuthServiceOptions {
  jwtSecret: string;
  jwtExpiresIn: string;
  otpExpiresMinutes: number;
   authTokenSecret: string;
  emailSender: AuthEmailSender;
  reportError: (error: unknown) => void;
}

const PASSWORD_HASH_ROUNDS = 12;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60_000;

const GENERIC_FORGOT_PASSWORD_MESSAGE =
  'If an account exists with that email, a password reset code has been sent.';

function generateOtp(): Promise<number> {
  return new Promise((resolve, reject) => {
    randomInt(100_000, 1_000_000, (error, value) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(value);
    });
  });
}

function hashResetValue(value: string, secret: string, purpose: 'otp' | 'reset'): string {
  return createHmac('sha256', secret)
    .update(`${purpose}:${value}`)
    .digest('hex');
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

function toSafeUser(user: UserDocument): AuthUserDTO {
  return {
    id: user._id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    ...(user.phone === undefined ? {} : { phone: user.phone }),
    ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl })
  };
}

export class AuthService {
  private readonly jwtKey: Uint8Array;

  constructor(
    private readonly repository: AuthRepository,
    private readonly options: AuthServiceOptions
  ) {
    this.jwtKey = new TextEncoder().encode(options.jwtSecret);
  }

  private async createAccessToken(user: UserDocument): Promise<string> {
    return new SignJWT({
      role: user.role,
      tokenVersion: user.tokenVersion
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user._id.toString())
      .setIssuedAt()
      .setExpirationTime(this.options.jwtExpiresIn)
      .sign(this.jwtKey);
  }

  private async createAuthResponse(
    user: UserDocument
  ): Promise<AuthTokenResponse> {
    return {
      accessToken: await this.createAccessToken(user),
      user: toSafeUser(user)
    };
  }

  async register(dto: RegisterDTO): Promise<AuthTokenResponse> {
    const existingUser = await this.repository.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS);

    try {
      const user = await this.repository.create({
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        password: passwordHash,
        role: 'student',
        tokenVersion: 0,
        ...(dto.phone === undefined ? {} : { phone: dto.phone }),
        ...(dto.avatarUrl === undefined ? {} : { avatarUrl: dto.avatarUrl })
      });

      return this.createAuthResponse(user);
    } catch (error: unknown) {
      // The unique email index also protects against simultaneous registrations.
      if (isDuplicateKeyError(error)) {
        throw new ConflictError('An account with this email already exists');
      }

      throw error;
    }
  }

  async login(dto: LoginDTO): Promise<AuthTokenResponse> {
    const user = await this.repository.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedError();
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password);

    if (!passwordMatches) {
      throw new UnauthorizedError();
    }

    return this.createAuthResponse(user);
  }

  async logout(userId: string): Promise<void> {
    const updated = await this.repository.incrementTokenVersion(userId);

    if (!updated) {
      throw new UnauthorizedError();
    }
  }

  async getMe(userId: string): Promise<AuthUserDTO> {
    const user = await this.repository.findById(userId);

    if (!user) {
      throw new NotFoundError('User');
    }

    return toSafeUser(user);
  }

  async forgotPassword(dto: ForgotPasswordDTO): Promise<string> {
    const code = String(await generateOtp());
    const hash = hashResetValue(
  code,
  this.options.authTokenSecret,
  'otp'
);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.options.otpExpiresMinutes * 60_000
    );

    const stored = await this.repository.storeResetOtp(
      dto.email,
      hash,
      expiresAt,
      now,
      OTP_RESEND_COOLDOWN_MS
    );

    // Unknown email and active cooldown produce the same public response.
    if (!stored) {
      return GENERIC_FORGOT_PASSWORD_MESSAGE;
    }

    try {
      await this.options.emailSender.sendPasswordResetCode(dto.email, code);
    } catch (error: unknown) {
      await this.repository.clearResetOtp(dto.email, hash);
      this.options.reportError(error);
    }

    return GENERIC_FORGOT_PASSWORD_MESSAGE;
  }

  async verifyResetCode(
  dto: VerifyResetCodeDTO
): Promise<{ resetToken: string }> {
  const state = await this.repository.findResetOtp(dto.email);
  const now = new Date();

  if (
    !state ||
    !state.hash ||
    !state.expiresAt ||
    state.expiresAt <= now ||
    state.attempts >= OTP_MAX_ATTEMPTS
  ) {
    throw new UnauthorizedError();
  }

  const expectedHash = Buffer.from(state.hash, 'hex');
  const providedHash = Buffer.from(
    hashResetValue(dto.code, this.options.authTokenSecret, 'otp'),
    'hex'
  );

  const matches =
    expectedHash.length === 32 &&
    providedHash.length === 32 &&
    timingSafeEqual(expectedHash, providedHash);

  if (!matches) {
    await this.repository.recordFailedOtpAttempt(
      dto.email,
      state.hash,
      OTP_MAX_ATTEMPTS
    );

    throw new UnauthorizedError();
  }

  const resetToken = randomBytes(32).toString('base64url');
  const resetTokenHash = hashResetValue(
    resetToken,
    this.options.authTokenSecret,
    'reset'
  );

  const resetTokenExpiresAt = new Date(
    now.getTime() + this.options.otpExpiresMinutes * 60_000
  );

  const issued = await this.repository.issuePasswordResetToken(
    dto.email,
    state.hash,
    resetTokenHash,
    resetTokenExpiresAt,
    now,
    OTP_MAX_ATTEMPTS
  );

  if (!issued) {
    throw new UnauthorizedError();
  }

  return { resetToken };
}

  async resetPassword(dto: ResetPasswordDTO): Promise<void> {
  const passwordHash = await bcrypt.hash(
    dto.newPassword,
    PASSWORD_HASH_ROUNDS
  );

  const resetTokenHash = hashResetValue(
    dto.resetToken,
    this.options.authTokenSecret,
    'reset'
  );

  const updated = await this.repository.resetPasswordWithToken(
    dto.email,
    resetTokenHash,
    passwordHash,
    new Date()
  );

  if (!updated) {
    throw new UnauthorizedError();
  }
}
}