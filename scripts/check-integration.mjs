import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import mongoose from 'mongoose';
import { SignJWT } from 'jose';

const databaseName = 'online_exam_check_' + randomBytes(8).toString('hex');
const mongoUri = 'mongodb://127.0.0.1:27017/' + databaseName;
const secret = randomBytes(32).toString('hex');
const key = new TextEncoder().encode(secret);
const connection = mongoose.createConnection(mongoUri, { serverSelectionTimeoutMS: 5000 });
const checks = [];
let serverProcess;
let serverExit;
let serverOutput = '';
const id = value => new mongoose.Types.ObjectId(value.toString(16).padStart(24, '0'));
const student = id(101), otherStudent = id(102), emptyStudent = id(103), failedStudent = id(104), admin = id(105);
const quiz = id(201), emptyQuiz = id(202), failedQuiz = id(203), badQuiz = id(204), largeQuiz = id(205), loadQuiz = id(206);
const q1 = id(301).toHexString(), q2 = id(302).toHexString();
const checked = (name, action) => { action(); checks.push(name); };
async function accessToken(user = student, role = 'student', version = 0) {
  return new SignJWT({ role, tokenVersion: version }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.toHexString()).setExpirationTime('5m').sign(key);
}
async function unusedPort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return address.port;
}
const port = await unusedPort();
const base = 'http://127.0.0.1:' + port + '/api/v1';
const environment = {
  ...process.env, NODE_ENV: 'test', PORT: String(port), MONGO_URI: mongoUri,
  JWT_SECRET: secret, JWT_EXPIRES_IN: '5m', OTP_EXPIRES_MINUTES: '10',
  USER_COLLECTION: 'users', QUIZ_COLLECTION: 'quizzes', ATTEMPT_COLLECTION: 'quizattempts',
  WORKER_TIMEOUT_MS: '30000', WORKER_MAX_PENDING: '4'
};
async function http(path, token) {
  const response = await fetch(base + path, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    signal: AbortSignal.timeout(35_000)
  });
  return { status: response.status, body: await response.json() };
}
async function ready() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error('Server stopped during startup: ' + serverOutput);
    try {
      const response = await http('/health');
      if (response.status === 200) return;
    } catch { /* A refused connection is expected before listen completes. */ }
    await setTimeout(50);
  }
  throw new Error('Server did not become ready: ' + serverOutput);
}
async function assertStartupFails(overrides, label, expectedMessage) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.js', import.meta.url))], {
    cwd: new URL('..', import.meta.url), env: { ...environment, ...overrides }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(15_000) }).catch(error => { child.kill(); throw new Error(label + ' timed out. Output: ' + output, { cause: error }); });
  checked(label, () => {
    assert.equal(code, 1);
    assert.ok(output.includes(expectedMessage), 'Expected startup error was not reported: ' + output);
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes(mongoUri));
  });
}
try {
  await connection.asPromise();
  const users = connection.collection('users');
  const quizzes = connection.collection('quizzes');
  const attempts = connection.collection('quizattempts');
  await users.insertMany([student, otherStudent, emptyStudent, failedStudent, admin].map(_id => ({
    _id, firstName: 'Test', lastName: _id.toHexString(), role: _id.equals(admin) ? 'admin' : 'student',
    tokenVersion: 0, passwordHash: 'must-never-be-returned'
  })));
  await quizzes.insertMany([quiz, emptyQuiz, failedQuiz, badQuiz, largeQuiz, loadQuiz].map(_id => ({ _id, title: 'Test Quiz' })));
  const attempt = (index, overrides = {}) => ({
    _id: id(1000 + index), studentId: student, quizId: quiz, status: 'SUBMITTED', passed: true,
    quizTitle: 'Test Quiz', quizImageUrl: null, questionsCount: 2, durationMinutes: 15,
    correctCount: 12, scorePercentage: 60, timeSpentSeconds: 90,
    submittedAt: new Date('2026-01-01T12:00:00.000Z'),
    questionResults: [{ questionId: q1, isCorrect: true }, { questionId: q2, isCorrect: false }],
    correctOptionIds: ['must-never-be-returned'], ...overrides
  });
  await attempts.insertMany([
    attempt(1),
    attempt(2, { passed: false, correctCount: 3, scorePercentage: 30, timeSpentSeconds: 30,
      submittedAt: new Date('2026-01-02T12:00:00.000Z'), questionResults: [{ questionId: q1, isCorrect: false }, { questionId: q2, isCorrect: false }] }),
    attempt(3, { status: 'EXPIRED', passed: false, correctCount: 99, submittedAt: new Date('2026-01-03T12:00:00.000Z') }),
    attempt(4, { status: 'IN_PROGRESS', correctCount: 99 }),
    attempt(5, { studentId: otherStudent, correctCount: 20, scorePercentage: 100, timeSpentSeconds: 10,
      questionResults: [{ questionId: q1, isCorrect: true }, { questionId: q2, isCorrect: true }] }),
    attempt(6, { studentId: failedStudent, quizId: failedQuiz, passed: false, correctCount: 1, scorePercentage: 10, timeSpentSeconds: 5 }),
    attempt(7, { quizId: badQuiz, questionResults: [{ questionId: q1, isCorrect: 'invalid' }] })
  ]);
  serverProcess = spawn(process.execPath, [fileURLToPath(new URL('./helpers/server-process.mjs', import.meta.url))], {
    cwd: new URL('..', import.meta.url), env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  serverExit = once(serverProcess, 'exit');
  serverProcess.stdout.on('data', data => { serverOutput += data; });
  serverProcess.stderr.on('data', data => { serverOutput += data; });
  await ready();
  checked('Server bootstrap and real database/worker readiness', () => assert.ok(true));
  const studentToken = await accessToken();
  const adminToken = await accessToken(admin, 'admin');
  const dashboard = await http('/dashboard/me', studentToken);
  checked('Live MongoDB KPIs exclude failed fastest times and non-submitted attempts', () => {
    assert.equal(dashboard.status, 200);
    // The intentionally invalid analytics document is still a submitted attempt for this student.
    assert.deepEqual(dashboard.body.data.kpis, { quizzesPassed: 2, fastestTimeSeconds: 90, totalCorrectAnswers: 27 });
    assert.equal(dashboard.body.data.profile.avatarUrl, null);
    assert.ok(!JSON.stringify(dashboard.body).includes('passwordHash'));
  });
  const isolated = await http('/dashboard/me', await accessToken(otherStudent));
  checked('Student data isolation', () => assert.deepEqual(isolated.body.data.kpis, { quizzesPassed: 1, fastestTimeSeconds: 10, totalCorrectAnswers: 20 }));
  const empty = await http('/dashboard/me', await accessToken(emptyStudent));
  checked('Empty dashboard uses zero counts and null fastest time', () => assert.deepEqual(empty.body.data.kpis, { quizzesPassed: 0, fastestTimeSeconds: null, totalCorrectAnswers: 0 }));
  const failed = await http('/dashboard/me', await accessToken(failedStudent));
  checked('All-failed dashboard keeps correct count and null fastest time', () => assert.deepEqual(failed.body.data.kpis, { quizzesPassed: 0, fastestTimeSeconds: null, totalCorrectAnswers: 1 }));
  const history = await http('/dashboard/history?page=1&limit=2', studentToken);
  checked('Real history pagination, UTC dates, newest ordering, and safe projection', () => {
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.meta, { page: 1, limit: 2, total: 4, totalPages: 2 });
    assert.deepEqual(history.body.data.map(entry => entry.attemptId), [id(1003).toHexString(), id(1002).toHexString()]);
    assert.equal(history.body.data[0].submittedAt, '2026-01-03T12:00:00.000Z');
    assert.ok(!JSON.stringify(history.body).includes('correctOptionIds'));
    assert.ok(!JSON.stringify(history.body).includes('questionResults'));
  });
  const outOfRange = await http('/dashboard/history?page=99', studentToken);
  checked('Out-of-range history preserves totals', () => { assert.deepEqual(outOfRange.body.data, []); assert.equal(outOfRange.body.meta.total, 4); });
  const analytics = await http('/admin/quizzes/' + quiz + '/analytics', adminToken);
  checked('Real MongoDB -> HTTP -> shared worker analytics', () => {
    assert.equal(analytics.status, 200);
    assert.deepEqual(analytics.body.data.latency, { p50: 30, p90: 90 });
    assert.equal(analytics.body.data.scoreDistribution.reduce((total, bucket) => total + bucket.count, 0), 3);
    assert.equal(analytics.body.data.scoreDistribution[9].count, 1);
    assert.equal(analytics.body.data.questions[0].failureRate, 1 / 3);
    assert.equal(analytics.body.data.questions[1].itemDiscrimination, 1);
  });
  const emptyAnalytics = await http('/admin/quizzes/' + emptyQuiz + '/analytics', adminToken);
  checked('Empty quiz analytics succeeds', () => { assert.equal(emptyAnalytics.status, 200); assert.deepEqual(emptyAnalytics.body.data.latency, { p50: null, p90: null }); });
  const authCases = [
    ['/dashboard/me', undefined, 401],
    ['/admin/quizzes/' + quiz + '/analytics', studentToken, 403],
    ['/dashboard/me', adminToken, 403],
    ['/dashboard/history?studentId=' + otherStudent, studentToken, 400],
    ['/dashboard/history?page=0', studentToken, 400],
    ['/admin/quizzes/not-an-id/analytics', adminToken, 400],
    ['/admin/quizzes/' + id(999) + '/analytics', adminToken, 404]
  ];
  for (const [path, token, expected] of authCases) {
    const response = await http(path, token);
    checked('Authorization/validation ' + expected + ': ' + path, () => assert.equal(response.status, expected));
  }
  await users.updateOne({ _id: student }, { $inc: { tokenVersion: 1 } });
  checked('Stored tokenVersion revokes an existing JWT', () => assert.ok(true));
  assert.equal((await http('/dashboard/me', studentToken)).status, 401);
  assert.equal((await http('/dashboard/me', await accessToken(student, 'student', 1))).status, 200);
  const bad = await http('/admin/quizzes/' + badQuiz + '/analytics', adminToken);
  checked('Malformed stored analytics gives a sanitized internal error', () => {
    assert.equal(bad.status, 500);
    assert.equal(bad.body.error.code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(bad.body).includes('questionResults'));
  });
  const oversized = Array.from({ length: 10_001 }, (_, index) => attempt(10_000 + index, { quizId: largeQuiz }));
  await attempts.insertMany(oversized);
  const limit = await http('/admin/quizzes/' + largeQuiz + '/analytics', adminToken);
  checked('Oversized analytics rejects instead of returning partial data', () => {
    assert.equal(limit.status, 422);
    assert.equal(limit.body.error.code, 'ANALYTICS_LIMIT');
  });
  const questions = Array.from({ length: 20 }, (_, index) => ({ questionId: id(3000 + index).toHexString(), isCorrect: index % 2 === 0 }));
  for (let offset = 0; offset < 5000; offset += 500) {
    await attempts.insertMany(Array.from({ length: 500 }, (_, index) => attempt(30_000 + offset + index, {
      quizId: loadQuiz, questionResults: questions, correctCount: 10, scorePercentage: (index % 101)
    })));
  }
  let finished = false;
  const started = performance.now();
  const job = http('/admin/quizzes/' + loadQuiz + '/analytics', adminToken).finally(() => { finished = true; });
  const healthSamples = [];
  while (!finished) {
    const sampleStart = performance.now();
    const response = await http('/health');
    healthSamples.push({ requestMs: performance.now() - sampleStart, status: response.status, metrics: response.body.data.eventLoop });
    await setTimeout(10);
  }
  const heavy = await job;
  checked('Analytics for 5,000 attempts / 100,000 question results completes', () => {
    assert.equal(heavy.status, 200);
    assert.equal(heavy.body.data.percentileRankings.length, 5000);
  });
  const finalHealth = await http('/health');
  checked('Public health responds during analytics', () => {
    assert.ok(healthSamples.length > 0);
    assert.ok(healthSamples.every(sample => sample.status === 200));
    assert.equal(finalHealth.status, 200);
    assert.ok(finalHealth.body.data.eventLoop.maxDelayMs < 100, 'Observed event-loop delay exceeded 100ms: ' + finalHealth.body.data.eventLoop.maxDelayMs);
  });
  const performanceResult = {
    attempts: 5000, questionResults: 100000, analyticsMs: Math.round(performance.now() - started),
    healthSamples: healthSamples.length, maxHealthRequestMs: Math.round(Math.max(...healthSamples.map(sample => sample.requestMs))),
    eventLoop: finalHealth.body.data.eventLoop
  };
  serverProcess.send('shutdown');
  const [exitCode] = await Promise.race([
    serverExit, setTimeout(12_000, null, { ref: false }).then(() => { throw new Error('Graceful shutdown timed out'); })
  ]);
  checked('Real HTTP server, worker, and database shutdown exits cleanly', () => assert.equal(exitCode, 0));
  serverProcess = undefined;
  await assertStartupFails({ JWT_SECRET: 'short' }, 'Invalid environment fails startup', 'Invalid environment:');
  await assertStartupFails({ MONGO_URI: 'mongodb://127.0.0.1:1/unreachable' }, 'Unavailable database fails startup without leaked configuration', 'Server could not start.');
  const blocker = createServer();
  blocker.listen(port);
  await once(blocker, 'listening');
  try { await assertStartupFails({}, 'Occupied HTTP port fails startup and releases workers/database', 'Server could not start.'); }
  finally { await new Promise(resolve => blocker.close(resolve)); }
  console.log(JSON.stringify({ passed: checks.length, checks, performance: performanceResult }, null, 2));
} finally {
  if (serverProcess && serverProcess.exitCode === null) {
    if (serverProcess.connected) serverProcess.send('shutdown');
    await Promise.race([serverExit, setTimeout(3000)]);
    if (serverProcess.exitCode === null) serverProcess.kill();
  }
  if (connection.readyState === 1) {
    assert.match(databaseName, /^online_exam_check_[a-f0-9]{16}$/);
    assert.equal(connection.name, databaseName);
    await connection.dropDatabase();
  }
  await connection.close();
}
