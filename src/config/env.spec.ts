import { describe, it, expect } from '@jest/globals';
import { parseEnvironment } from './env.js';
import { randomBytes } from 'node:crypto';

const valid = { MONGO_URI: 'mongodb://localhost/exams', JWT_SECRET: randomBytes(32).toString('hex') };
describe('environment validation', () => {
  it.each(['0s', '0m', '0h', '0d', '00h'])('rejects a zero lifetime %s', JWT_EXPIRES_IN => {
    expect(() => parseEnvironment({ ...valid, JWT_EXPIRES_IN })).toThrow('JWT_EXPIRES_IN');
  });
  it.each(['replace-with-a-random-secret-at-least-32-characters', 'a'.repeat(64), '01234567'.repeat(8), '0123456789abcdef'.repeat(4)])('rejects a placeholder or low-diversity key', JWT_SECRET => {
    expect(() => parseEnvironment({ ...valid, JWT_SECRET })).toThrow('JWT_SECRET');
  });
  it.each(['mongodb://db.example/exams?tls=false', 'mongodb+srv://db.example/exams?tls=false', 'mongodb://db.example/exams?tlsInsecure=true', 'mongodb://db.example/exams?tlsAllowInvalidCertificates=true'])('rejects insecure production URI %s', MONGO_URI => {
    expect(() => parseEnvironment({ ...valid, NODE_ENV: 'production', MONGO_URI })).toThrow('MONGO_URI');
  });
  it('accepts development loopback and production URIs whose options will enforce TLS', () => {
    expect(parseEnvironment(valid).NODE_ENV).toBe('development');
    expect(parseEnvironment({ ...valid, NODE_ENV: 'production', MONGO_URI: 'mongodb://db.example/exams' }).NODE_ENV).toBe('production');
  });
  it('parses explicit trusted proxy networks and rejects blanket trust', () => {
    expect(parseEnvironment({ ...valid, TRUST_PROXY: '127.0.0.1/32,::1/128' }).TRUST_PROXY).toEqual(['127.0.0.1/32', '::1/128']);
    expect(parseEnvironment(valid).TRUST_PROXY).toBe(false);
    for (const TRUST_PROXY of ['true', '1', '0.0.0.0/0', '::/0', '127.0.0.1/00', '127.0.0.1/33', '::1/129', 'example.com']) {
      expect(() => parseEnvironment({ ...valid, TRUST_PROXY })).toThrow('TRUST_PROXY');
    }
  });
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
