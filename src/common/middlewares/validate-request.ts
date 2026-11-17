import type { RequestHandler } from 'express';
import type { z } from 'zod';

// Parsed values are put in locals because Express 5 query is read-only.
export function validateRequest<T>(schema: z.ZodType<T>, source: 'body' | 'query' | 'params', key: string = source): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) { next(result.error); return; }
    res.locals[key] = result.data;
    next();
  };
}
