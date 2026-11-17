import mongoose from 'mongoose';
import type { Connection } from 'mongoose';

export async function connectDatabase(uri: string): Promise<Connection> {
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 5000, maxPoolSize: 10, bufferCommands: false
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
