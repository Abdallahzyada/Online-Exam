import { describe, it, expect } from '@jest/globals';
import { parseEnvironment } from './env.js';

const valid = { MONGO_URI: 'mongodb://localhost/exams', JWT_SECRET: 'a'.repeat(32) };
describe('environment validation', () => {
  it('parses numbers and applies defaults', () => {
    expect(parseEnvironment({ ...valid, PORT: '4000' })).toMatchObject({ PORT: 4000, OTP_EXPIRES_MINUTES: 10, WORKER_MAX_PENDING: 4 });
  });
  it.each([
    { JWT_SECRET: 'short' }, { MONGO_URI: 'https://example.com' }, { PORT: 'abc' },
    { PORT: '70000' }, { NODE_ENV: 'unknown' }, { JWT_EXPIRES_IN: 'forever' }, { WORKER_MAX_PENDING: '0' }
  ])('fails fast on invalid configuration %j', invalid => {
    expect(() => parseEnvironment({ ...valid, ...invalid })).toThrow('Invalid environment:');
  });
  it('does not expose invalid secret values', () => {
    expect(() => parseEnvironment({ ...valid, JWT_SECRET: 'private' })).not.toThrow('private');
    expect(() => parseEnvironment({ ...valid, JWT_SECRET: 'private' })).toThrow('JWT_SECRET');
  });
});
