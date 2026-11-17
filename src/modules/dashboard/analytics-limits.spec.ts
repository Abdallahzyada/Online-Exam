import { describe, it, expect } from '@jest/globals';
import { analyticsPayloadSchema } from './dashboard.dto.js';
import { MAX_QUESTION_RESULTS, questionResultCount } from './analytics-limits.js';
import { calculateQuizAnalytics } from './dashboard.analytics.js';
import { makeAttempt } from './testing/fixtures.js';

describe('analytics aggregate bounds and canonical IDs', () => {
  it('rejects total question count before reading individual result fields', () => {
    const questions = new Array(1000);
    Object.defineProperty(questions, '0', { get: () => { throw new Error('Nested input was read before preflight'); } });
    const payload = { attempts: Array.from({ length: 101 }, () => ({ questionResults: questions })) };
    expect(questionResultCount(payload)).toBeNull();
    const parsed = analyticsPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
  it('accepts exactly the aggregate bound', () => {
    const payload = { attempts: Array.from({ length: MAX_QUESTION_RESULTS / 1000 }, () => ({ questionResults: Array(1000).fill(null) })) };
    expect(questionResultCount(payload)).toBe(MAX_QUESTION_RESULTS);
  });
  it.each([null, {}, { attempts: [{}] }, { attempts: Array(10001).fill({ questionResults: [] }) }, { attempts: [{ questionResults: Array(1001) }] }])('rejects invalid shallow payloads', payload => {
    expect(questionResultCount(payload)).toBeNull();
  });
  it('combines case variants of one question across attempts', () => {
    const first = { ...makeAttempt(1, 0, 1, false), questionResults: [{ questionId: 'ABCDEF123456ABCDEF123456', isCorrect: false }] };
    const second = { ...makeAttempt(2, 100, 2), questionResults: [{ questionId: 'abcdef123456abcdef123456', isCorrect: true }] };
    expect(calculateQuizAnalytics({ attempts: [first, second] }).questions).toEqual([
      { questionId: 'abcdef123456abcdef123456', itemDiscrimination: 1, failureRate: 0.5 }
    ]);
  });
  it('rejects case-variant duplicates within one attempt', () => {
    const attempt = { ...makeAttempt(1, 50, 1), questionResults: [
      { questionId: 'ABCDEF123456ABCDEF123456', isCorrect: true },
      { questionId: 'abcdef123456abcdef123456', isCorrect: false }
    ] };
    expect(() => calculateQuizAnalytics({ attempts: [attempt] })).toThrow('Duplicate');
  });
});
