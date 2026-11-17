import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { WorkerManager } from '../dist/common/workers/worker-manager.js';

// Real threads with the same production manager; fault injection is test-only.
const workerUrl = new URL('../dist/common/workers/analytics.worker.js', import.meta.url);
async function waitUntilReady(manager) {
  const deadline = Date.now() + 10_000;
  while (!manager.isReady()) {
    if (Date.now() >= deadline) throw new Error('Worker did not become ready');
    await setTimeout(10);
  }
}
const task = { taskType: 'quiz-analytics', payload: { attempts: Array.from({ length: 1000 }, (_, index) => ({
  attemptId: index.toString(16).padStart(24, '0'), scorePercentage: 50, timeSpentSeconds: index + 1,
  questionResults: [{ questionId: '000000000000000000000001', isCorrect: index % 2 === 0 }]
})) } };
function verifyResult(result) {
  assert.equal(result.scoreDistribution[5].count, 1000);
  assert.deepEqual(result.latency, { p50: 500, p90: 900 });
  assert.equal(result.questions[0].failureRate, 0.5);
}
const handles = [];
const manager = new WorkerManager({
  timeoutMs: 10_000, maxPending: 4,
  factory: () => {
    const worker = new Worker(workerUrl);
    handles.push(worker);
    return worker;
  }
});
try {
  manager.start();
  await waitUntilReady(manager);
  (await Promise.all([manager.run(task), manager.run(task)])).forEach(verifyResult);
  assert.equal(handles.length, 1);
  await handles[0].terminate();
  await waitUntilReady(manager);
  assert.equal(handles.length, 2);
  verifyResult(await manager.run(task));
} finally { await manager.close(); }
console.log('Passed: worker reuse, concurrent requests, idle exit recovery.');

for (const mode of ['error', 'exit', 'timeout']) {
  let created = 0;
  const resilient = new WorkerManager({
    timeoutMs: mode === 'timeout' ? 2000 : 10_000, maxPending: 2,
    factory: () => ++created === 1
      ? new Worker(new URL('./helpers/fault-worker.mjs', import.meta.url), { workerData: { mode } })
      : new Worker(workerUrl)
  });
  try {
    resilient.start();
    await waitUntilReady(resilient);
    const outcomes = await Promise.allSettled([resilient.run(task), resilient.run(task)]);
    for (const outcome of outcomes) {
      assert.equal(outcome.status, 'rejected');
      const expected = mode === 'timeout' ? 'WORKER_TIMEOUT' : mode === 'exit' ? 'WORKER_EXITED' : 'WORKER_FAILED';
      assert.equal(outcome.reason.code, expected);
    }
    await waitUntilReady(resilient);
    assert.equal(created, 2);
    verifyResult(await resilient.run(task));
  } finally { await resilient.close(); }
  console.log('Passed: real worker ' + mode + ' rejects both pending requests and recovers.');
}
