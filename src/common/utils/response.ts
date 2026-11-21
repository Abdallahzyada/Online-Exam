import type { Response } from "express";

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: { page: number; limit: number; total: number; totalPages: number }
): void {
  res.status(statusCode).json({
    success: true,
    data,
    ...(meta ? { meta } : {})
  });
}
