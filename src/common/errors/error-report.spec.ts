import { describe, it, expect } from '@jest/globals';
import { describeError } from './error-report.js';
import { AppError } from './app-error.js';

describe('log-safe error description', () => {
  it('uses the public code for application errors', () => {
    expect(describeError(new AppError(503, 'WORKER_FAILED', 'private detail'))).toBe('WORKER_FAILED');
  });

  it('keeps the class name and stack frames but never the message', () => {
    const error = new TypeError('mongodb://admin:secret@db.internal/exams');
    const text = describeError(error);
    expect(text.split('\n')[0]).toBe('Unexpected runtime failure: TypeError');
    expect(text).toMatch(/\n {4}at /);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('mongodb://');
  });

  it('limits the number of stack frames', () => {
    const error = new Error('deep');
    error.stack = ['Error: deep', ...Array.from({ length: 30 }, (_, index) => `    at frame${index} (file.js:1:1)`)].join('\n');
    expect(describeError(error).split('\n')).toHaveLength(11);
  });

  it('does not trust an unusual error name', () => {
    const error = new Error('x');
    error.name = 'password=hunter2';
    error.stack = 'password=hunter2: x';
    expect(describeError(error)).toBe('Unexpected runtime failure: Error');
  });

  it('falls back to a generic line for thrown non-errors', () => {
    expect(describeError('token abc123')).toBe('Unexpected runtime failure');
    expect(describeError(undefined)).toBe('Unexpected runtime failure');
  });
});
