import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { withFileLock } from './helpers/file-lock.mjs';
import { writePrivateFile } from './helpers/private-file.mjs';

const rotate = process.argv.includes('--rotate-key');
if (process.argv.slice(2).some(argument => argument !== '--rotate-key')) throw new Error('Unknown setup option');

await withFileLock(new URL('../.local/setup-env.lock', import.meta.url), async () => {
  const file = new URL('../.env', import.meta.url);
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    text = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  }
  const match = /^JWT_SECRET=(.*)$/m.exec(text);
  if (rotate || !match || !match[1].trim() || match[1].includes('replace-with-')) {
    const line = 'JWT_SECRET=' + randomBytes(32).toString('hex');
    text = match ? text.replace(/^JWT_SECRET=.*$/m, line) : text.trimEnd() + '\n' + line + '\n';
    await writePrivateFile(fileURLToPath(file), text);
    console.log('Local .env is ready with a newly generated signing key. Restart the server to use it.');
  } else {
    await writePrivateFile(fileURLToPath(file), text);
    console.log('Existing signing key preserved with private file permissions. Format checks cannot verify randomness. Use --rotate-key to generate a new random key.');
  }
});
