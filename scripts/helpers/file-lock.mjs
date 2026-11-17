import { mkdir, open, unlink } from 'node:fs/promises';

export async function withFileLock(lockFile, work) {
  await mkdir(new URL('./', lockFile), { recursive: true });
  let handle;
  try { handle = await open(lockFile, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another manual fixture command holds the lock. Wait for it to finish.');
    throw error;
  }
  try { return await work(); }
  finally { await handle.close(); await unlink(lockFile); }
}
