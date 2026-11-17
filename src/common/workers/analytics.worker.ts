import { parentPort } from 'node:worker_threads';
import { calculateQuizAnalytics } from '../../modules/dashboard/dashboard.analytics.js';
import { workerRequestSchema } from './worker-protocol.js';

const port = parentPort;
if (!port) throw new Error('Analytics worker must run in a worker thread');
port.on('message', (message: unknown) => {
  const request = workerRequestSchema.parse(message);
  try {
    const result = calculateQuizAnalytics(request.payload);
    port.postMessage({ type: 'result', requestId: request.requestId, result });
  } catch {
    port.postMessage({ type: 'error', requestId: request.requestId, message: 'Analytics calculation failed' });
  }
});
port.postMessage({ type: 'ready' });
