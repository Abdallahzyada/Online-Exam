import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import { productionMongoUriIsSecure } from './mongo-security.js';

export async function connectDatabase(uri: string, production = false): Promise<Connection> {
  if (production && !productionMongoUriIsSecure(uri)) throw new Error('Production MongoDB requires verified TLS');
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 5000, maxPoolSize: 10, bufferCommands: false,
    ...(production ? { tls: true, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false } : {})
  });
  try {
    return await connection.asPromise();
  } catch (error: unknown) {
    await connection.close();
    throw error;
  }
}

export async function disconnectDatabase(connection: Connection): Promise<void> {
  await connection.close();
}
