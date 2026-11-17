import { jest, describe, it, expect } from '@jest/globals';
import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import { connectDatabase } from './database.js';

describe('production database transport', () => {
  it('forces certificate-verified TLS through the actual connection boundary', async () => {
    const boundary = { asPromise: jest.fn<() => Promise<Connection>>() };
    const connection = boundary as unknown as Connection;
    boundary.asPromise.mockResolvedValue(connection);
    const create = jest.spyOn(mongoose, 'createConnection').mockReturnValue(connection);
    await expect(connectDatabase('mongodb://db.example/exams', true)).resolves.toBe(connection);
    const calls: readonly unknown[] = create.mock.calls;
    expect(calls[0]).toEqual(['mongodb://db.example/exams', expect.objectContaining({
      tls: true, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false
    })]);
  });
  it('rejects a URI that disables transport security before creating a connection', async () => {
    const create = jest.spyOn(mongoose, 'createConnection');
    await expect(connectDatabase('mongodb://db.example/exams?tls=false', true)).rejects.toThrow('verified TLS');
    expect(create).not.toHaveBeenCalled();
  });
});
