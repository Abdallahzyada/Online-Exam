// Test fixture only. Never loaded by the application.
import { parentPort, workerData } from 'node:worker_threads';
parentPort.on('message', () => {
  if (workerData.mode === 'error') throw new Error('Injected worker failure');
  if (workerData.mode === 'exit') process.exit(2);
  // Timeout mode deliberately leaves the request unanswered.
});
parentPort.postMessage({ type: 'ready' });
