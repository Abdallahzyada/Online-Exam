import { jest, describe, it, expect } from '@jest/globals';
import mongoose from 'mongoose';
import { connectDatabase } from './database.js';

describe('production database transport', () => {
  it('forces certificate-verified TLS through the actual connection boundary', async () => {
    const connect = jest.spyOn(mongoose, "connect").mockResolvedValue(mongoose);
    await expect(connectDatabase("mongodb://localhost:27017/exams", true)).resolves.toBe(mongoose.connection);
    const calls: readonly unknown[] = connect.mock.calls;
    expect(calls[0]).toEqual(['mongodb://localhost:27017/exams', expect.objectContaining({
      tls: true, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false
    })]);
  });
  it('rejects a URI that disables transport security before creating a connection', async () => {
    const create = jest.spyOn(mongoose, 'connect');
    await expect(connectDatabase('mongodb://localhost:27017/exams?tls=false', true)).rejects.toThrow('verified TLS');
    expect(create).not.toHaveBeenCalled();
  });
});
