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

  it('succeeds across multiple batches without MongoDB transactions', async () => {
    // Three complete batches of batchSize=2 plus a remainder of 1
    const lines = Array.from({ length: 7 }, (_, i) => JSON.stringify(question(i))).join('\n');
    const batchCalls: number[] = [];
    const report = await importNdjsonQuestions(Readable.from([lines]), async batch => {
      batchCalls.push(batch.length);
      return batch.length;
    }, 2);
    expect(report.importedCount).toBe(7);
    expect(report.skippedCount).toBe(0);
    expect(batchCalls).toEqual([2, 2, 2, 1]);
  });

  it('reports importedCount from successful batches only when a later batch fails', async () => {
    // 3 valid questions with batchSize=1 → batch 1 succeeds, batch 2 fails, batch 3 never runs
    const lines = Array.from({ length: 3 }, (_, i) => JSON.stringify(question(i))).join('\n');
    let call = 0;
    const insertBatch = jest.fn(async (batch: readonly unknown[]) => {
      call += 1;
      if (call === 2) throw new Error('DB write error on batch 2');
      return batch.length;
    });
    await expect(
      importNdjsonQuestions(Readable.from([lines]), insertBatch, 1)
    ).rejects.toThrow('DB write error on batch 2');
    // Only the first batch succeeded
    expect(insertBatch).toHaveBeenCalledTimes(2);
  });

  it('does not count a failed DB insert as a skipped/validation line', async () => {
    // A batch insert DB failure must propagate as a thrown error, not as a skipped line,
    // so the caller can distinguish real insertion failures from invalid-data skips.
    const line = JSON.stringify(question(1));
    const dbError = new Error('Network timeout');
    await expect(
      importNdjsonQuestions(Readable.from([line]), async () => { throw dbError; }, 1)
    ).rejects.toThrow('Network timeout');
  });

  it('destroys the stream and cleans up readline on a mid-stream error', async () => {
    const source = Readable.from([
      JSON.stringify(question(1)) + '\n',
      JSON.stringify(question(2)) + '\n'
    ]);
    const destroyed: boolean[] = [];
    source.on('close', () => destroyed.push(source.destroyed));
    const dbError = new Error('Disk full');
    await expect(
      importNdjsonQuestions(source, async () => { throw dbError; }, 1)
    ).rejects.toThrow('Disk full');
    // Source stream must have been cleaned up (destroyed via lineGuard chain)
    expect(source.destroyed).toBe(true);
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

describe('CSV formula injection protection', () => {
  it('prefixes dangerous formula starters with a tab character', async () => {
    const rows = [{ a: '=SUM(A1:A2)', b: '+cmd|/C calc', c: '-1+2', d: '@SUM(A1)' }];
    const output = await collect(Readable.from(rows), 'csv', ['a', 'b', 'c', 'd']);
    expect(output).toContain('\t=SUM(A1:A2)');
    expect(output).toContain('\t+cmd|/C calc');
    expect(output).toContain('\t-1+2');
    expect(output).toContain('\t@SUM(A1)');
  });

  it('leaves safe values and empty cells untouched', async () => {
    const output = await collect(Readable.from([{ text: 'Hello World', empty: '' }]), 'csv', ['text', 'empty']);
    expect(output).toContain('Hello World');
    expect(output).not.toContain('\tHello World');
    expect(output).toContain(',\r\n');
  });

  it('applies protection to multi-row exports consistently', async () => {
    const rows = [{ text: 'safe' }, { text: '=EVIL()' }, { text: 'also safe' }];
    const output = await collect(Readable.from(rows), 'csv', ['text']);
    const lines = output.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('text');
    expect(lines[1]).toBe('safe');
    expect(lines[2]).toBe('\t=EVIL()');
    expect(lines[3]).toBe('also safe');
  });

  it('sanitizes numeric-like strings that start with a minus or plus sign', async () => {
    const output = await collect(Readable.from([{ v: '-1+2' }, { v: '+99' }]), 'csv', ['v']);
    expect(output).toContain('\t-1+2');
    expect(output).toContain('\t+99');
  });
});