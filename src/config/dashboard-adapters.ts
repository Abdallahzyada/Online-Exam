import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { z } from 'zod';
import { sessionSchema } from '../common/middlewares/auth-jwt.js';
import type { SessionReader } from '../common/middlewares/auth-jwt.js';
import type { ProfileReader, QuizReader } from '../modules/dashboard/dashboard.ports.js';

const profileSchema = z.object({
  firstName: z.string(), lastName: z.string(), avatarUrl: z.string().nullable().optional()
}).transform(profile => ({ ...profile, avatarUrl: profile.avatarUrl ?? null }));

// Read-only adapters. The owning modules remain responsible for their models.
export function createMongoReaders(connection: Connection, collections: { users: string; quizzes: string }): {
  sessions: SessionReader; profiles: ProfileReader; quizzes: QuizReader
} {
  const users = connection.collection(collections.users);
  return {
    sessions: {
      async findSession(userId) {
        const document = await users.findOne({ _id: new Types.ObjectId(userId) }, { projection: { role: 1, tokenVersion: 1 } });
        if (!document) return null;
        const parsed = sessionSchema.safeParse(document);
        if (!parsed.success) throw new Error('Stored user session does not match the shared contract');
        return parsed.data;
      }
    },
    profiles: {
      async findProfile(userId) {
        const document = await users.findOne({ _id: new Types.ObjectId(userId) }, { projection: { firstName: 1, lastName: 1, avatarUrl: 1 } });
        if (!document) return null;
        const parsed = profileSchema.safeParse(document);
        if (!parsed.success) throw new Error('Stored profile does not match the shared contract');
        return parsed.data;
      }
    },
    quizzes: {
      async exists(quizId) {
        return await connection.collection(collections.quizzes).findOne(
          { _id: new Types.ObjectId(quizId) }, { projection: { _id: 1 }, timeoutMS: 5000 }
        ) !== null;
      }
    }
  };
}
