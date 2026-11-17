import { z } from 'zod';
import { mongoUriIsValid, productionMongoUriIsSecure } from './mongo-security.js';
import { validProxyAddress } from './trusted-proxy.js';

export const jwtSecretSchema = z.string().regex(/^[a-f0-9]{64}$/i, 'Generate 32 random bytes encoded as 64 hex characters')
  .refine(value => new Set(value.toLowerCase()).size >= 10 && !/^(.{1,32})\1+$/.test(value.toLowerCase()), 'Use a securely generated random key');
const trustedProxySchema = z.string().default('').transform(value => value.split(',').map(part => part.trim()).filter(Boolean))
  .refine(values => values.every(validProxyAddress), 'Use explicit trusted proxy IP addresses or CIDRs')
  .transform((values): false | string[] => values.length ? values : false);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGO_URI: z.string().refine(mongoUriIsValid, 'Use a valid MongoDB connection URL'),
  JWT_SECRET: jwtSecretSchema,
  JWT_EXPIRES_IN: z.string().regex(/^[1-9]\d*(?:s|m|h|d)$/, 'Use a positive duration such as 1h').default('1h'),
  OTP_EXPIRES_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: trustedProxySchema,
  USER_COLLECTION: z.string().min(1).default('users'),
  QUIZ_COLLECTION: z.string().min(1).default('quizzes'),
  ATTEMPT_COLLECTION: z.string().min(1).default('quizattempts'),
  WORKER_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(30_000),
  WORKER_MAX_PENDING: z.coerce.number().int().min(1).max(32).default(4)
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && !productionMongoUriIsSecure(env.MONGO_URI)) {
    context.addIssue({ code: 'custom', path: ['MONGO_URI'], message: 'Production requires verified TLS; disabling TLS or certificate checks is not allowed' });
  }
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
