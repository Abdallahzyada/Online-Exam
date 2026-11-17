import { jest, describe, it, expect } from '@jest/globals';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { createMongoReaders } from './dashboard-adapters.js';

const id = '111111111111111111111111';
function setup() {
  const findOne = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const collection = jest.fn((_name: string) => ({ findOne }));
  // Only the MongoDB boundary is replaced; the real readers run in each test.
  const connection = { collection } as unknown as Connection;
  return { findOne, collection, readers: createMongoReaders(connection, { users: 'users', quizzes: 'quizzes' }) };
}
describe('read-only shared Mongo adapters', () => {
  it('reads only session fields and scopes by ObjectId', async () => {
    const { readers, findOne } = setup();
    findOne.mockResolvedValue({ role: 'student', tokenVersion: 2, password: 'private' });
    await expect(readers.sessions.findSession(id)).resolves.toEqual({ role: 'student', tokenVersion: 2 });
    expect(findOne).toHaveBeenCalledWith({ _id: new Types.ObjectId(id) }, { projection: { role: 1, tokenVersion: 1 } });
  });
  it('maps a missing account to null', async () => {
    const { readers, findOne } = setup();
    findOne.mockResolvedValue(null);
    await expect(readers.sessions.findSession(id)).resolves.toBeNull();
    await expect(readers.profiles.findProfile(id)).resolves.toBeNull();
  });
  it('returns a sanitized profile with a null default avatar', async () => {
    const { readers, findOne } = setup();
    findOne.mockResolvedValue({ firstName: 'Mohammed', lastName: 'Student', passwordHash: 'private' });
    await expect(readers.profiles.findProfile(id)).resolves.toEqual({ firstName: 'Mohammed', lastName: 'Student', avatarUrl: null });
  });
  it('preserves an existing avatar', async () => {
    const { readers, findOne } = setup();
    const profile = { firstName: 'Mohammed', lastName: 'Student', avatarUrl: 'https://example.com/photo.jpg' };
    findOne.mockResolvedValue(profile);
    await expect(readers.profiles.findProfile(id)).resolves.toEqual(profile);
  });
  it('treats incompatible stored data as an internal error', async () => {
    const { readers, findOne } = setup();
    findOne.mockResolvedValue({ role: 'other' });
    await expect(readers.sessions.findSession(id)).rejects.toThrow('Stored user session');
    await expect(readers.profiles.findProfile(id)).rejects.toThrow('Stored profile');
  });
  it('checks quiz existence without loading quiz data', async () => {
    const { readers, findOne, collection } = setup();
    findOne.mockResolvedValueOnce({ _id: new Types.ObjectId(id) }).mockResolvedValueOnce(null);
    await expect(readers.quizzes.exists(id)).resolves.toBe(true);
    await expect(readers.quizzes.exists(id)).resolves.toBe(false);
    expect(collection).toHaveBeenCalledWith('quizzes');
    expect(findOne).toHaveBeenCalledWith({ _id: new Types.ObjectId(id) }, { projection: { _id: 1 }, timeoutMS: 5000 });
  });
});
