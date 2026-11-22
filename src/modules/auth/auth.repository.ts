import { Types, type Connection, type Model } from 'mongoose';
import { createUserModel } from './auth.model.js';
import type { UserDocument, UserRecord } from './auth.model.js';

export interface CreateUserData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  avatarUrl?: string;
  role: 'student' | 'admin';
  tokenVersion: number;
}

export interface ResetOtpState {
  hash: string | null;
  expiresAt: Date | null;
  attempts: number;
}

export class AuthRepository {
  private readonly users: Model<UserRecord>;

  constructor(connection: Connection, collectionName: string) {
    this.users = createUserModel(connection, collectionName);
  }

  async create(data: CreateUserData): Promise<UserDocument> {
    return this.users.create(data);
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.users
      .findOne({ email })
      .select('+password')
      .exec();
  }

  async findById(userId: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(userId)) return null;

    return this.users.findById(userId).exec();
  }

  async incrementTokenVersion(userId: string): Promise<boolean> {
    const result = await this.users.updateOne(
      { _id: userId },
      { $inc: { tokenVersion: 1 } }
    );

    return result.modifiedCount === 1;
  }

  async storeResetOtp(
    email: string,
    hash: string,
    expiresAt: Date,
    now: Date,
    cooldownMs: number
  ): Promise<boolean> {
    const cooldownBoundary = new Date(now.getTime() - cooldownMs);

    const user = await this.users.findOneAndUpdate(
      {
        email,
        $or: [
          { resetOtpSentAt: { $exists: false } },
          { resetOtpSentAt: { $lte: cooldownBoundary } }
        ]
      },
      {
        $set: {
          resetOtpHash: hash,
          resetOtpExpiresAt: expiresAt,
          resetOtpSentAt: now,
          resetOtpAttempts: 0
        },
                $unset: {
  resetTokenHash: 1,
  resetTokenExpiresAt: 1
}
      },
      { new: true }
    ).select('_id').exec();

    return user !== null;
  }

  async findResetOtp(email: string): Promise<ResetOtpState | null> {
    const user = await this.users
      .findOne({ email })
      .select('+resetOtpHash +resetOtpExpiresAt +resetOtpAttempts')
      .exec();

    if (!user) return null;

    return {
  hash: user.resetOtpHash ?? null,
  expiresAt: user.resetOtpExpiresAt ?? null,
  attempts: user.resetOtpAttempts
};
  }

  async recordFailedOtpAttempt(
    email: string,
    hash: string,
    maxAttempts: number
  ): Promise<number | null> {
    const user = await this.users.findOneAndUpdate(
      {
        email,
        resetOtpHash: hash,
        resetOtpAttempts: { $lt: maxAttempts }
      },
      { $inc: { resetOtpAttempts: 1 } },
      { new: true }
    ).select('+resetOtpAttempts').exec();

    if (!user) return null;

    if (user.resetOtpAttempts >= maxAttempts) {
      await this.clearResetOtp(email, hash);
    }

    return user.resetOtpAttempts;
  }

 async issuePasswordResetToken(
  email: string,
  otpHash: string,
  resetTokenHash: string,
  resetTokenExpiresAt: Date,
  now: Date,
  maxAttempts: number
): Promise<boolean> {
  const result = await this.users.updateOne(
    {
      email,
      resetOtpHash: otpHash,
      resetOtpExpiresAt: { $gt: now },
      resetOtpAttempts: { $lt: maxAttempts }
    
    },
    {
      $set: {
        resetTokenHash,
        resetTokenExpiresAt
      },
      $unset: {
        resetOtpHash: 1,
        resetOtpExpiresAt: 1,
        resetOtpSentAt: 1
        
      }
      
    }
  );

  return result.modifiedCount === 1;
}

 async clearResetOtp(email: string, hash?: string): Promise<void> {
  await this.users.updateOne(
    {
      email,
      ...(hash ? { resetOtpHash: hash } : {})
    },
    {
      $unset: {
        resetOtpHash: 1,
        resetOtpExpiresAt: 1,
        resetOtpSentAt: 1
      },
      $set: {
        resetOtpAttempts: 0
      }
    }
  );
}

  async resetPasswordWithToken(
  email: string,
  resetTokenHash: string,
  passwordHash: string,
  now: Date
): Promise<boolean> {
  const result = await this.users.updateOne(
    {
      email,
      resetTokenHash,
      resetTokenExpiresAt: { $gt: now }
    },
    {
      $set: { password: passwordHash },
      $inc: { tokenVersion: 1 },
      $unset: {
        resetTokenHash: 1,
        resetTokenExpiresAt: 1,
        resetOtpHash: 1,
        resetOtpExpiresAt: 1,
        resetOtpSentAt: 1,
        resetOtpAttempts: 1
      }
    }
  );

  return result.modifiedCount === 1;
}
}