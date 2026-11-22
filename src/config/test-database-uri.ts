import { loadEnvFile } from 'node:process';
import { ConnectionString } from 'mongodb-connection-string-url';

export function testMongoBaseUri(override?: string): string {
  try { loadEnvFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return override ?? process.env.TEST_MONGO_URI ?? process.env.MONGO_URI
    ?? 'mongodb://127.0.0.1:27018/?replicaSet=examLocal';
}

export function temporaryMongoUri(base: string, databaseName: string): string {
  const uri = new ConnectionString(base);
  // MongoDB otherwise authenticates against the database path we are replacing.
  if ((uri.username || uri.password) && !uri.searchParams.has('authSource')) {
    uri.searchParams.set('authSource', decodeURIComponent(uri.pathname.slice(1)) || 'admin');
  }
  uri.pathname = '/' + databaseName;
  return uri.toString();
}
