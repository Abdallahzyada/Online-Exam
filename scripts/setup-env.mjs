import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { withFileLock } from './helpers/file-lock.mjs';

await withFileLock(new URL('../.local/setup-env.lock', import.meta.url), async () => {
  const file = new URL('../.env', import.meta.url);
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    text = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  }
  const match = /^JWT_SECRET=(.*)$/m.exec(text);
  if (!match || !match[1].trim() || match[1].includes('replace-with-')) {
    const line = 'JWT_SECRET=' + randomBytes(32).toString('hex');
    text = match ? text.replace(/^JWT_SECRET=.*$/m, line) : text.trimEnd() + '\n' + line + '\n';
    await writeFile(file, text);
    console.log('Local .env is ready with a newly generated signing key. Restart the server to use it.');
  } else {
    console.log('Existing local signing key preserved. Startup will validate its format.');
  }
});
