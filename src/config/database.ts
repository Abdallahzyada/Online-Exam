import mongoose from "mongoose";
import type { Connection } from "mongoose";
import { productionMongoUriIsSecure } from "./mongo-security.js";

export async function connectDatabase(
  uri: string,
  production = false,
): Promise<Connection> {
  if (production && !productionMongoUriIsSecure(uri))
    throw new Error("Production MongoDB requires verified TLS");
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
      bufferCommands: false,
      ...(production ? { tls: true, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames:false } : {}),
    });
    return mongoose.connection;
  } catch (error: unknown) {
    await mongoose.disconnect();
    throw error;
  }
}

export async function disconnectDatabase(
  connection: Connection,
): Promise<void> {
  await connection.close();
}
