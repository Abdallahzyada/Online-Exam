import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, stat, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writePrivateFile } from './helpers/private-file.mjs';

const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'exam-env-check-'));
try {
  await mkdir(join(root, 'scripts', 'helpers'), { recursive: true });
  for (const file of ['setup-env.mjs', 'helpers/private-file.mjs', 'helpers/file-lock.mjs']) {
    await copyFile(new URL(file, import.meta.url), join(root, 'scripts', file));
  }
  await writeFile(join(root, '.env.example'), 'PORT=4567\nJWT_SECRET=replace-with-generated-key\n');
  const setup = (...args) => run(process.execPath, [join(root, 'scripts/setup-env.mjs'), ...args]);
  const file = join(root, '.env');
  const firstRun = await setup();
  const initial = await readFile(file, 'utf8');
  const firstKey = /^JWT_SECRET=([a-f0-9]{64})$/m.exec(initial)?.[1];
  assert.ok(firstKey);
  assert.ok(!firstRun.stdout.includes(firstKey));
  assert.ok(initial.includes('PORT=4567'));
  await setup();
  assert.equal(await readFile(file, 'utf8'), initial);
  await setup('--rotate-key');
  const rotated = await readFile(file, 'utf8');
  assert.notEqual(rotated, initial);
  assert.ok(rotated.includes('PORT=4567'));
  await assert.rejects(writePrivateFile(file, 'partial replacement', async () => { throw new Error('Interrupted before replacement'); }));
  assert.equal(await readFile(file, 'utf8'), rotated);
  assert.ok(!(await readdir(root)).some(name => name.endsWith('.tmp')));
  if (process.platform === 'win32') {
    const { stdout } = await run('icacls.exe', [file], { windowsHide: true });
    assert.ok(!stdout.includes('(I)'));
    assert.ok(!/S-1-1-0|Everyone:|BUILTIN\\Users:|Authenticated Users:/.test(stdout));
  } else {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
  console.log('Environment setup checks passed: random generation, key preservation, explicit rotation, private permissions, atomic replacement, interrupted-write recovery.');
} finally {
  // This directory was created by mkdtemp for this check only.
  assert.ok(root.startsWith(join(tmpdir(), 'exam-env-check-')));
  await rm(root, { recursive: true, force: true });
}
