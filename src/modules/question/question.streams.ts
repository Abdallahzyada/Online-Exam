import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import type { Readable, TransformCallback } from 'node:stream';
import { questionSchema } from './question.dto.js';
import type { QuestionInput } from './question.dto.js';
import type { ImportIssue, ImportReport } from './question.ports.js';
import { AppError } from '../../common/errors/app-error.js';

export const QUESTION_IMPORT_BATCH_SIZE = 100;
export const QUESTION_IMPORT_MAX_REPORTED_ERRORS = 100;
export const QUESTION_IMPORT_MAX_LINE_BYTES = 64 * 1024;
export const QUESTION_IMPORT_MAX_LINES = 100_000;

function createLineSizeGuard(): Transform {
  let lineBytes = 0;
  return new Transform({
    transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (const byte of bytes) {
        if (byte === 10) lineBytes = 0;
        else {
          lineBytes += 1;
          if (lineBytes > QUESTION_IMPORT_MAX_LINE_BYTES) {
            callback(new AppError(413, 'REQUEST_ERROR', 'An NDJSON line exceeds the 64 KB limit'));
            return;
          }
        }
      }
      callback(null, bytes);
    }
  });
}

export async function importNdjsonQuestions(
  source: Readable,
  insertBatch: (batch: readonly QuestionInput[]) => Promise<number>,
  batchSize = QUESTION_IMPORT_BATCH_SIZE
): Promise<ImportReport> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new RangeError('Batch size must be between 1 and 1000');
  }

  const lineGuard = createLineSizeGuard();
  const onSourceError = (error: Error) => lineGuard.destroy(error);
  source.once('error', onSourceError);
  source.pipe(lineGuard);
  const lines = createInterface({ input: lineGuard, crlfDelay: Infinity, terminal: false });
  const batch: QuestionInput[] = [];
  const errors: ImportIssue[] = [];
  let totalLines = 0;
  let importedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  const addIssue = (line: number, message: string) => {
    skippedCount += 1;
    errorCount += 1;
    if (errors.length < QUESTION_IMPORT_MAX_REPORTED_ERRORS) errors.push({ line, message });
  };

  const flush = async () => {
    if (batch.length === 0) return;
    const current = batch.splice(0, batch.length);
    importedCount += await insertBatch(current);
  };

  try {
    for await (const line of lines) {
      totalLines += 1;
      if (totalLines > QUESTION_IMPORT_MAX_LINES) {
        throw new AppError(413, 'REQUEST_ERROR', `Import exceeds the ${QUESTION_IMPORT_MAX_LINES.toLocaleString()}-line limit`);
      }
      if (line.trim().length === 0) {
        addIssue(totalLines, 'Line is empty');
        continue;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(line) as unknown;
      } catch {
        addIssue(totalLines, 'Invalid JSON');
        continue;
      }

      const parsedQuestion = questionSchema.safeParse(parsedJson);
      if (!parsedQuestion.success) {
        const issue = parsedQuestion.error.issues[0];
        addIssue(totalLines, issue ? `${issue.path.join('.') || 'question'}: ${issue.message}` : 'Invalid question');
        continue;
      }

      batch.push(parsedQuestion.data);
      if (batch.length >= batchSize) await flush();
    }
    await flush();
  } finally {
    lines.close();
    source.off('error', onSourceError);
    if (!lineGuard.destroyed) lineGuard.destroy();
  }

  return {
    totalLines,
    importedCount,
    skippedCount,
    errors,
    errorsTruncated: errorCount > errors.length
  };
}

export interface ExportFormatOptions {
  readonly format: 'ndjson' | 'csv';
  readonly columns?: readonly string[];
  readonly fallbackColumns?: readonly string[];
}

function csvCell(value: unknown): string {
  let normalized: string;
  if (value === null || value === undefined) normalized = '';
  else if (typeof value === 'string') normalized = value;
  else if (value instanceof Date) normalized = value.toISOString();
  else if (typeof value === 'object') normalized = JSON.stringify(value);
  else normalized = String(value);
  return /[",\r\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

export function createExportTransform(options: ExportFormatOptions): Transform {
  let headerWritten = false;
  let columns = options.columns ? [...options.columns] : undefined;
  return new Transform({
    writableObjectMode: true,
    transform(document: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
      try {
        const record = document !== null && typeof document === 'object'
          ? document as Record<string, unknown> : { value: document };
        if (options.format === 'ndjson') {
          this.push(`${JSON.stringify(record)}\n`);
          callback();
          return;
        }
        if (!headerWritten) {
          columns ??= Object.keys(record);
          this.push(`${columns.map(csvCell).join(',')}\r\n`);
          headerWritten = true;
        }
        this.push(`${(columns ?? []).map(column => csvCell(record[column])).join(',')}\r\n`);
        callback();
      } catch (error: unknown) {
        callback(error instanceof Error ? error : new Error('Could not format export row'));
      }
    },
    flush(callback) {
      if (options.format === 'csv' && !headerWritten) {
        columns ??= options.fallbackColumns ? [...options.fallbackColumns] : [];
        this.push(`${columns.map(csvCell).join(',')}\r\n`);
      }
      callback();
    }
  });
}

export const QUESTION_EXPORT_COLUMNS = [
  '_id', 'quizId', 'type', 'text', 'options', 'correctOptionIds', 'points', 'createdAt', 'updatedAt'
] as const;

export const ATTEMPT_EXPORT_COLUMNS = [
  '_id', 'studentId', 'quizId', 'status', 'startedAt', 'expiresAt', 'submittedAt',
  'questionsCount', 'durationMinutes', 'correctCount', 'incorrectCount', 'earnedPoints',
  'totalPoints', 'scorePercentage', 'passed', 'timeSpentSeconds', 'answers', 'questionResults'
] as const;
