import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { withFileLock } from './helpers/file-lock.mjs';

const folder = await mkdtemp(join(tmpdir(), 'exam-fixture-lock-'));
const lock = pathToFileURL(join(folder, 'manual.lock'));
let release, entered;
const gate = new Promise(resolve => { release = resolve; });
const acquired = new Promise(resolve => { entered = resolve; });
try {
  const seeding = withFileLock(lock, async () => { entered(); await gate; });
  await acquired;
  let cleanupRan = false;
  await assert.rejects(withFileLock(lock, async () => { cleanupRan = true; }), /holds the lock/);
  assert.equal(cleanupRan, false);
  release(); await seeding;
  await withFileLock(lock, async () => { cleanupRan = true; });
  assert.equal(cleanupRan, true);
  await assert.rejects(withFileLock(lock, async () => { throw new Error('Interrupted seed'); }), /Interrupted seed/);
  await withFileLock(lock, async () => undefined);
  console.log('Passed: concurrent fixture commands cannot overlap; the lock is released after success and failure.');
} finally {
  release();
  assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
  assert.ok(basename(folder).startsWith('exam-fixture-lock-'));
  await rm(folder, { recursive: true });
}
