const messages = {
  VALIDATION_ERROR: 'Invalid request', UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'Access denied', NOT_FOUND: 'Resource not found', CONFLICT: 'Resource conflict',
  ANALYTICS_LIMIT: 'Quiz exceeds the supported analytics size',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable', WORKER_TIMEOUT: 'Service temporarily unavailable',
  INTERNAL_ERROR: 'Service temporarily unavailable', WORKER_FAILED: 'Service temporarily unavailable',
  WORKER_EXITED: 'Service temporarily unavailable', WORKER_PROTOCOL_ERROR: 'Service temporarily unavailable',
  ANALYTICS_FAILED: 'Service temporarily unavailable'
} as const;

export function publicError(code: string, status: number): { code: string; message: string } {
  if (!Object.prototype.hasOwnProperty.call(messages, code)) {
    return { code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message: status >= 500 ? 'Service temporarily unavailable' : 'Request could not be completed' };
  }
  return { code, message: status >= 500 ? 'Service temporarily unavailable' : messages[code as keyof typeof messages] };
}
