import type { PublicErrorDetail } from './public-details.js';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: readonly PublicErrorDetail[] = []
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details: readonly PublicErrorDetail[] = []) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}
export class UnauthorizedError extends AppError {
  constructor() { super(401, 'UNAUTHORIZED', 'Authentication required'); }
}
export class ForbiddenError extends AppError {
  constructor() { super(403, 'FORBIDDEN', 'Access denied'); }
}
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') { super(404, 'NOT_FOUND', `${resource} not found`); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(409, 'CONFLICT', message); }
}
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') { super(503, 'SERVICE_UNAVAILABLE', message); }
}
