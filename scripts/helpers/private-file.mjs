import { open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export async function writePrivateFile(file, text, beforeRename = async () => {}) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    if (process.platform === 'win32') {
      const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
      const sid = stdout.match(/S-1-[\d-]+/)?.[0];
      if (!sid) throw new Error('Could not identify the file owner');
      await run('icacls.exe', [temporary, '/inheritance:r', '/grant:r', '*' + sid + ':(F)', '*S-1-5-18:(F)'], { windowsHide: true });
    }
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await beforeRename(temporary);
    await rename(temporary, file);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
