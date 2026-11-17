import { describe, it, expect, jest } from '@jest/globals';
import type { Connection } from 'mongoose';
import { ensureDashboardIndexes } from './dashboard-indexes.js';

const history = { studentId: 1, submittedAt: -1, _id: -1, status: 1 };
const analytics = { quizId: 1, status: 1, _id: 1 };
function setup(indexes: unknown[], error?: unknown) {
  const createIndex = jest.fn<(key: unknown, options: unknown) => Promise<string>>().mockResolvedValue('created');
  const toArray = error ? async () => { throw error; } : async () => indexes;
  const connection = { collection: () => ({ listIndexes: () => ({ toArray }), createIndex }) } as unknown as Connection;
  return { connection, createIndex };
}
describe('shared dashboard indexes', () => {
  it('reuses equivalent indexes regardless of the owner names', async () => {
    const { connection, createIndex } = setup([{ key: history, name: 'owner_history' }, { key: analytics, name: 'owner_analytics' }]);
    await ensureDashboardIndexes(connection, 'attempts');
    expect(createIndex).not.toHaveBeenCalled();
  });
  it('creates indexes when the collection does not exist yet', async () => {
    const { connection, createIndex } = setup([], { code: 26 });
    await ensureDashboardIndexes(connection, 'attempts');
    expect(createIndex).toHaveBeenCalledTimes(2);
  });
  it.each([{ hidden: true }, { sparse: true }, { unique: true }, { partialFilterExpression: { status: 'SUBMITTED' } }, { collation: { locale: 'en' } }])('does not reuse an index with incompatible options %j', async options => {
    const { connection, createIndex } = setup([{ key: history, ...options }, { key: analytics }]);
    await ensureDashboardIndexes(connection, 'attempts');
    expect(createIndex).toHaveBeenCalledWith(history, { name: 'dashboard_student_history' });
  });
  it('propagates index inspection errors other than missing collection', async () => {
    const { connection } = setup([], new Error('Not authorized'));
    await expect(ensureDashboardIndexes(connection, 'attempts')).rejects.toThrow('Not authorized');
  });
});
