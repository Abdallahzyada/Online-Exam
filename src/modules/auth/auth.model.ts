import { Schema, type Connection, type HydratedDocument, type Model } from 'mongoose';
import type { Role } from '../../common/middlewares/auth-jwt.js';

export interface UserRecord {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  avatarUrl?: string;
  role: Role;
  tokenVersion: number;

    resetOtpHash?: string;
  resetOtpExpiresAt?: Date;
  resetOtpSentAt?: Date;
  resetOtpAttempts: number;

  resetTokenHash?: string;
  resetTokenExpiresAt?: Date;
}

export type UserDocument = HydratedDocument<UserRecord>;

const userSchema = new Schema<UserRecord>(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254
    },
    password: { type: String, required: true, select: false },
    phone: { type: String, trim: true, maxlength: 20 },
    avatarUrl: { type: String, trim: true },
    role: {
      type: String,
      enum: ['student', 'admin'],
      default: 'student',
      required: true
    },
    tokenVersion: { type: Number, default: 0, min: 0, required: true },

     resetOtpHash: { type: String, select: false },
    resetOtpExpiresAt: { type: Date, select: false },
    resetOtpSentAt: { type: Date, select: false },
    resetOtpAttempts: { type: Number, default: 0, select: false },

    resetTokenHash: { type: String, select: false },
    resetTokenExpiresAt: { type: Date, select: false }
    
  },
  {
    timestamps: true,
    versionKey: false
  }
);

userSchema.index({ email: 1 }, { unique: true });

export function createUserModel(
  connection: Connection,
  collectionName: string
): Model<UserRecord> {
  const existing = connection.models.User as Model<UserRecord> | undefined;

  return existing ?? connection.model<UserRecord>('User', userSchema, collectionName);
}