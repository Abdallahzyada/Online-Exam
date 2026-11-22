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
const keys = ['JWT_SECRET', 'AUTH_TOKEN_SECRET'];

for (const key of keys) {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(text);

  if (
    rotate ||
    !match ||
    !match[1].trim() ||
    match[1].includes('replace-with-')
  ) {
    const line = `${key}=${randomBytes(32).toString('hex')}`;

    text = match
      ? text.replace(new RegExp(`^${key}=.*$`, 'm'), line)
      : text.trimEnd() + '\n' + line + '\n';
  }
}

await writePrivateFile(fileURLToPath(file), text);
console.log('Local .env is ready. Existing keys were preserved unless missing or rotation was requested.');
});
