import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';
import { createExportTransform } from './question.streams.js';

export interface StreamExportOptions {
  readonly filename: string;
  readonly format: 'ndjson' | 'csv';
  readonly compress?: 'gzip';
  readonly columns?: readonly string[];
  readonly fallbackColumns?: readonly string[];
}

export async function streamCursorToResponse(
  req: Request,
  res: Response,
  cursor: Readable,
  options: StreamExportOptions
): Promise<void> {
  const abortController = new AbortController();
  const onRequestClosed = () => { if (!req.complete) abortController.abort(); };
  const onResponseClosed = () => { if (!res.writableEnded) abortController.abort(); };

  req.once('close', onRequestClosed);
  res.once('close', onResponseClosed);

  const extension = options.format === 'csv' ? 'csv' : 'ndjson';
  const compressedExtension = options.compress === 'gzip' ? '.gz' : '';
  res.status(200);
  res.setHeader('Content-Type', options.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${options.filename}.${extension}${compressedExtension}"`);
  res.setHeader('Cache-Control', 'no-store');
  if (options.compress === 'gzip') res.setHeader('Content-Encoding', 'gzip');
  res.flushHeaders();

  const formatter = createExportTransform({
    format: options.format,
    ...(options.columns ? { columns: options.columns } : {}),
    ...(options.fallbackColumns ? { fallbackColumns: options.fallbackColumns } : {})
  });
  try {
    if (options.compress === 'gzip') {
      await pipeline(cursor, formatter, createGzip(), res, { signal: abortController.signal });
    } else {
      await pipeline(cursor, formatter, res, { signal: abortController.signal });
    }
  } catch (error: unknown) {
    if (!abortController.signal.aborted) throw error;
  } finally {
    req.off('close', onRequestClosed);
    res.off('close', onResponseClosed);
    if (!cursor.destroyed) cursor.destroy();
  }
}
