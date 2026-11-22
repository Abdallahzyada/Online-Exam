import { spawn } from 'node:child_process';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { withFileLock } from './helpers/file-lock.mjs';
import { writePrivateFile } from './helpers/private-file.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--write-env' && !/^--port=\d+$/.test(arg))) {
  throw new Error('Use --write-env and/or --port=27018');
}
const port = Number(args.find(arg => arg.startsWith('--port='))?.split('=')[1] ?? 27018);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local MongoDB port');
const root = new URL('..', import.meta.url);
const directory = fileURLToPath(new URL(`.local/mongodb-rs-${port}/`, root));
const uri = `mongodb://127.0.0.1:${port}/online-exam?replicaSet=examLocal`;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function listening() {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

async function executable() {
  if (process.env.MONGOD_PATH) return process.env.MONGOD_PATH;
  if (process.platform === 'win32') {
    const installations = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'MongoDB', 'Server');
    const versions = await readdir(installations).catch(() => []);
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (versions[0]) return join(installations, versions[0], 'bin', 'mongod.exe');
  }
  return 'mongod';
}

await mkdir(directory, { recursive: true });
// mongod's own data-directory lock serializes competing starts. No launcher lock
// is left behind if this short-lived process is interrupted.
async function start() {
  let child;
  let connection;
  let ready = false;
  try {
    if (!await listening()) {
      await mkdir(join(directory, 'data'), { recursive: true });
      const log = await open(join(directory, 'launcher.log'), 'a');
      try {
        child = spawn(await executable(), [
          '--dbpath', join(directory, 'data'), '--logpath', join(directory, 'mongod.log'),
          '--logappend', '--port', String(port), '--bind_ip', '127.0.0.1',
          '--replSet', 'examLocal', '--oplogSize', '128'
        ], { detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        child.unref();
      } finally { await log.close(); }
      const deadline = Date.now() + 20_000;
      while (!await listening()) {
        if (child.exitCode !== null || Date.now() > deadline) {
          throw new Error(`MongoDB did not start. Check ${join(directory, 'mongod.log')} and MONGOD_PATH.`);
        }
        await delay(200);
      }
    }
    connection = mongoose.createConnection(`mongodb://127.0.0.1:${port}/admin?directConnection=true`, {
      serverSelectionTimeoutMS: 3000, socketTimeoutMS: 5000
    });
    await connection.asPromise();
    async function verifyOwner() {
      const options = await connection.db.admin().command({ getCmdLineOpts: 1 });
      const actualPath = options.parsed?.storage?.dbPath;
      if (!actualPath || resolve(actualPath) !== resolve(directory, 'data')) {
        throw new Error('This port belongs to another database directory. Choose another --port.');
      }
      if (child) {
        const status = await connection.db.admin().command({ serverStatus: 1 });
        if (child.exitCode !== null || Number(status.pid) !== child.pid) {
          throw new Error('The reachable database is not the process started by this command.');
        }
      }
    }
    await verifyOwner();
    try {
      const status = await connection.db.admin().command({ replSetGetStatus: 1 });
      if (status.set !== 'examLocal') throw new Error('This port belongs to another replica set. It was not changed.');
    } catch (error) {
      // Only initialize a new process started by this command. Never convert an existing server.
      if (error.code !== 94 || !child) throw error;
      await verifyOwner();
      await connection.db.admin().command({ replSetInitiate: {
        _id: 'examLocal', members: [{ _id: 0, host: `127.0.0.1:${port}` }]
      } });
    }
    const deadline = Date.now() + 20_000;
    while (true) {
      const hello = await connection.db.admin().command({ hello: 1 });
      if (hello.setName === 'examLocal' && hello.isWritablePrimary) break;
      if (Date.now() > deadline) throw new Error('The local replica set did not become ready.');
      await delay(200);
    }
    ready = true;
    if (args.includes('--write-env')) {
      await verifyOwner();
      await withFileLock(new URL('.local/setup-env.lock', root), async () => {
        const file = new URL('.env', root);
        // Require setup:env first; it creates private signing keys as well as the file.
        const text = await readFile(file, 'utf8');
        const updated = /^MONGO_URI=.*$/m.test(text)
          ? text.replace(/^MONGO_URI=.*$/m, `MONGO_URI=${uri}`)
          : text.trimEnd() + `\nMONGO_URI=${uri}\n`;
        await writePrivateFile(fileURLToPath(file), updated);
      });
      console.log('Updated only MONGO_URI in the private .env. Existing database data was not moved.');
    }
    console.log(`Local MongoDB replica set ready: ${uri}`);
    console.log('Run this command again after restarting your computer. Use this setup for local development only.');
    console.log('Single-user machines only: this localhost database has no authentication.');
  } finally {
    await connection?.close();
    if (child && !ready) child.kill();
  }
}
await start();
