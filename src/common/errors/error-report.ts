import { AppError } from './app-error.js';

const MAX_FRAMES = 10;
const SAFE_NAME = /^[A-Za-z][\w$]{0,63}$/;

/**
 * Log-safe text for an error: the AppError code, or the error class name plus stack
 * frames. The message is left out on purpose, because it can carry request data or
 * configuration such as a MongoDB URI with credentials.
 */
export function describeError(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (!(error instanceof Error)) return 'Unexpected runtime failure';
  const name = SAFE_NAME.test(error.name) ? error.name : 'Error';
  const frames = (error.stack ?? '').split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('at '))
    .slice(0, MAX_FRAMES);
  return [`Unexpected runtime failure: ${name}`, ...frames.map(frame => `    ${frame}`)].join('\n');
}
