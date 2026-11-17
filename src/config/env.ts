import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGO_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//, 'Use a MongoDB connection URL'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().regex(/^\d+(?:s|m|h|d)$/, 'Use a duration such as 1h').default('1h'),
  OTP_EXPIRES_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  USER_COLLECTION: z.string().min(1).default('users'),
  QUIZ_COLLECTION: z.string().min(1).default('quizzes'),
  ATTEMPT_COLLECTION: z.string().min(1).default('quizattempts'),
  WORKER_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(30_000),
  WORKER_MAX_PENDING: z.coerce.number().int().min(1).max(32).default(4)
});
export type Environment = z.infer<typeof envSchema>;

export function parseEnvironment(input: unknown): Environment {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment: ${fields.join('; ')}`);
  }
  return result.data;
}
