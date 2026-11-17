import { describe, it, expect } from '@jest/globals';
import { publicErrorDetails } from './public-details.js';

describe('public error details', () => {
  it('strips values, free-text messages, and unknown fields', () => {
    const details = publicErrorDetails([{ path: 'name', code: 'custom', value: 'private', token: 'private', message: 'private' }]);
    expect(details).toEqual([{ path: 'name', code: 'custom', message: 'Invalid field value' }]);
    expect(JSON.stringify(details)).not.toContain('private');
  });
  it('rejects malformed details and caps their number', () => {
    expect(publicErrorDetails(null)).toEqual([]);
    expect(publicErrorDetails([{ path: 'bad\npath', code: 'custom' }, { path: 'name', code: 'untrusted' }])).toEqual([]);
    expect(publicErrorDetails(Array.from({ length: 200 }, () => ({ path: 'name', code: 'custom' })))).toHaveLength(100);
  });
});
