import { describe, expect, it, jest } from '@jest/globals';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  createExportTransform, importNdjsonQuestions, QUESTION_IMPORT_BATCH_SIZE,
  QUESTION_IMPORT_MAX_LINE_BYTES
} from './question.streams.js';

function question(index: number) {
  return {
    type: 'single', text: `Question ${index}`,
    options: [{ optionId: 'a', text: 'A' }, { optionId: 'b', text: 'B' }],
    correctOptionIds: ['a']
  };
}

async function collect(source: Readable, format: 'ndjson' | 'csv', columns?: readonly string[]): Promise<string> {
  let output = '';
  const sink = new Writable({ write(chunk: Buffer, _encoding, callback) { output += chunk.toString(); callback(); } });
  await pipeline(source, createExportTransform({ format, ...(columns ? { columns } : {}) }), sink);
  return output;
}

describe('NDJSON question import', () => {
  it('parses chunks split across JSON tokens and inserts in bounded batches', async () => {
    const first = JSON.stringify(question(1));
    const second = JSON.stringify(question(2));
    const source = Readable.from([Buffer.from(first.slice(0, 12)), Buffer.from(first.slice(12) + '\r\n' + second + '\n')]);
    const batches: number[] = [];
    const report = await importNdjsonQuestions(source, async batch => { batches.push(batch.length); return batch.length; }, 1);
    expect(report).toMatchObject({ totalLines: 2, importedCount: 2, skippedCount: 0, errors: [], errorsTruncated: false });
    expect(batches).toEqual([1, 1]);
  });

  it('isolates malformed JSON, blank lines, and invalid questions', async () => {
    const input = [JSON.stringify(question(1)), '{bad json', '', JSON.stringify({ ...question(2), correctOptionIds: ['missing'] })].join('\n');
    const insertBatch = jest.fn(async (batch: readonly unknown[]) => batch.length);
    const report = await importNdjsonQuestions(Readable.from([input]), insertBatch);
    expect(report).toMatchObject({ totalLines: 4, importedCount: 1, skippedCount: 3 });
    expect(report.errors.map(error => error.line)).toEqual([2, 3, 4]);
    expect(insertBatch).toHaveBeenCalledTimes(1);
  });

  it('flushes at the configured batch size rather than retaining the entire file', async () => {
    const lines = Array.from({ length: QUESTION_IMPORT_BATCH_SIZE + 1 }, (_, index) => JSON.stringify(question(index))).join('\n');
    const batchLengths: number[] = [];
    const report = await importNdjsonQuestions(Readable.from([lines]), async batch => {
      batchLengths.push(batch.length);
      return batch.length;
    });
    expect(report.importedCount).toBe(QUESTION_IMPORT_BATCH_SIZE + 1);
    expect(batchLengths).toEqual([QUESTION_IMPORT_BATCH_SIZE, 1]);
  });

  it('caps the number of returned error details while counting every skipped line', async () => {
    const lines = Array.from({ length: 105 }, () => '{bad json').join('\n');
    const report = await importNdjsonQuestions(Readable.from([lines]), async batch => batch.length);
    expect(report.skippedCount).toBe(105);
    expect(report.errors).toHaveLength(100);
    expect(report.errorsTruncated).toBe(true);
  });

  it('rejects a line larger than the configured memory bound', async () => {
    const line = ' '.repeat(QUESTION_IMPORT_MAX_LINE_BYTES + 1);
    await expect(importNdjsonQuestions(Readable.from([line]), async batch => batch.length)).rejects.toMatchObject({ statusCode: 413 });
  });

  it('rejects invalid batch sizes', async () => {
    await expect(importNdjsonQuestions(Readable.from([]), async batch => batch.length, 0)).rejects.toThrow(RangeError);
  });
});

describe('stream export formatter', () => {
  it('writes one JSON document per NDJSON line', async () => {
    const output = await collect(Readable.from([{ id: 1 }, { id: 2 }]), 'ndjson', ['id']);
    expect(output).toBe('{"id":1}\n{"id":2}\n');
  });

  it('escapes CSV commas, quotes, and line breaks', async () => {
    const output = await collect(Readable.from([{ text: 'a,"b"\nc' }]), 'csv', ['text']);
    expect(output).toBe('text\r\n"a,""b""\nc"\r\n');
  });

  it('writes a CSV header for an empty cursor', async () => {
    const output = await collect(Readable.from([]), 'csv', ['id', 'text']);
    expect(output).toBe('id,text\r\n');
  });

  it('infers every attempt field for CSV exports when the schema evolves', async () => {
    const output = await collect(Readable.from([{ _id: '1', quizId: '2', snapshot: [{ text: 'Q' }] }]), 'csv');
    expect(output).toContain('_id,quizId,snapshot\r\n');
    expect(output).toContain('"[{""text"":""Q""}]"');
  });
});
