import { describe, expect, it } from '@jest/globals';
import { temporaryMongoUri } from './test-database-uri.js';

describe('temporary MongoDB connection', () => {
  it('keeps the server, replica set and other options', () => {
    expect(temporaryMongoUri('mongodb://localhost:27019/original?replicaSet=examLocal', 'temporary'))
      .toBe('mongodb://localhost:27019/temporary?replicaSet=examLocal');
  });
  it('preserves the original implicit authentication database', () => {
    expect(temporaryMongoUri('mongodb://user:password@localhost/accounts', 'temporary'))
      .toBe('mongodb://user:password@localhost/temporary?authSource=accounts');
  });
  it('keeps an explicit authentication database', () => {
    expect(temporaryMongoUri('mongodb://user:password@localhost/accounts?authSource=admin', 'temporary'))
      .toBe('mongodb://user:password@localhost/temporary?authSource=admin');
  });
  it('uses admin when credentials have no original database', () => {
    expect(temporaryMongoUri('mongodb://user:password@localhost/', 'temporary'))
      .toBe('mongodb://user:password@localhost/temporary?authSource=admin');
  });
});
