import type { RequestHandler } from 'express';
import type { Readable } from 'node:stream';
import type { QuestionInput, QuestionPatch } from './question.dto.js';
import type { QuestionRecord } from './question.model.js';

export interface QuestionRepository {
  quizExists(quizId: string): Promise<boolean>;
  findById(questionId: string): Promise<QuestionRecord | null>;
  create(quizId: string, input: QuestionInput): Promise<QuestionRecord>;
  update(questionId: string, patch: QuestionPatch): Promise<QuestionRecord | null>;
  delete(questionId: string): Promise<boolean>;
  insertMany(quizId: string, questions: readonly QuestionInput[]): Promise<number>;
  findByQuizCursor(quizId: string): Readable;
}

/** Must return a cursor created by the Attempt owner's Mongoose model, not a second model. */
export interface AttemptExportSource {
  findByQuizCursor(quizId: string): Readable;
}

export interface QuestionAuth {
  readonly authenticate: RequestHandler;
  readonly requireAdmin: RequestHandler;
}

export interface ImportIssue {
  readonly line: number;
  readonly message: string;
}

export interface ImportReport {
  readonly totalLines: number;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly errors: readonly ImportIssue[];
  readonly errorsTruncated: boolean;
}
