import { describe, expect, it, jest } from '@jest/globals';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { Readable } from 'node:stream';
import { ServiceUnavailableError } from '../../common/errors/app-error.js';
import { createAttemptExportSource } from './question.attempt-adapter.js';

describe('Attempt export adapter', () => {
  it('uses the Attempt owner model and does not create a new schema', () => {
    const cursor = Readable.from([{ _id: 'attempt' }]);
    const cursorMethod = jest.fn((_options: { batchSize: number }) => cursor);
    const lean = jest.fn(() => ({ cursor: cursorMethod }));
    const sort = jest.fn((_order: Record<string, number>) => ({ lean }));
    const find = jest.fn((_filter: Record<string, unknown>) => ({ sort }));
    const model = { find } as unknown as Model<Record<string, unknown>>;
    const connection = { models: { QuizAttempt: model } } as unknown as Connection;
    const source = createAttemptExportSource(connection);
    expect(source.findByQuizCursor('aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(cursor);
    expect(find).toHaveBeenCalledWith({ quizId: new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa') });
    expect(sort).toHaveBeenCalledWith({ _id: 1 });
    expect(cursorMethod).toHaveBeenCalledWith({ batchSize: 100 });
  });

  it('returns a clear readiness error before the Attempt model is registered', () => {
    const connection = { models: {} } as unknown as Connection;
    expect(() => createAttemptExportSource(connection).findByQuizCursor('aaaaaaaaaaaaaaaaaaaaaaaa'))
      .toThrow(ServiceUnavailableError);
  });
});
