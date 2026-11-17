import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';

export function createErrorHandler(report: (error: unknown) => void): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: {
        code: 'VALIDATION_ERROR', message: 'Invalid request',
        details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
      } });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: {
        code: error.code, message: error.message, details: error.details
      } });
      return;
    }
    // Body-parser errors are recognized by code, without exposing the request body.
    const bodyError = z.object({ type: z.enum(['entity.parse.failed', 'entity.too.large']) }).safeParse(error);
    if (bodyError.success) {
      const tooLarge = bodyError.data.type === 'entity.too.large';
      res.status(tooLarge ? 413 : 400).json({ success: false, error: {
        code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR',
        message: tooLarge ? 'Request body is too large' : 'Invalid JSON body', details: []
      } });
      return;
    }
    report(error);
    res.status(500).json({ success: false, error: {
      code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: []
    } });
  };
}
