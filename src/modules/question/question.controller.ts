import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { asyncHandler } from '../../common/middlewares/async-handler.js';
import { success } from '../../common/utils/response-envelope.js';
import type { AttemptExportSource } from './question.ports.js';
import { QuestionService } from './question.service.js';
import { streamCursorToResponse } from './question.export.js';
import { ATTEMPT_EXPORT_COLUMNS, QUESTION_EXPORT_COLUMNS } from './question.streams.js';
import type { QuestionInput, QuestionPatch } from './question.dto.js';

interface Params { readonly quizId?: string; readonly questionId?: string }
interface ExportQuery { readonly format: 'ndjson' | 'csv'; readonly compress?: 'gzip' }

export class QuestionController {
  constructor(
    private readonly service: QuestionService,
    private readonly attempts?: AttemptExportSource
  ) {}

  readonly create = asyncHandler(async (_req, res) => {
    const params = res.locals.params as Params;
    const body = res.locals.body as QuestionInput;
    const question = await this.service.createQuestion(params.quizId ?? '', body);
    res.status(201).json(success(question));
  });

  readonly update = asyncHandler(async (_req, res) => {
    const params = res.locals.params as Params;
    const body = res.locals.body as QuestionPatch;
    const question = await this.service.updateQuestion(params.questionId ?? '', body);
    res.status(200).json(success(question));
  });

  readonly remove = asyncHandler(async (_req, res) => {
    const params = res.locals.params as Params;
    const result = await this.service.deleteQuestion(params.questionId ?? '');
    res.status(200).json(success(result));
  });

  readonly import = asyncHandler(async (req, res) => {
    const params = res.locals.params as Params;
    const contentType = (req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/x-ndjson' && contentType !== 'application/ndjson') {
      throw new AppError(415, 'REQUEST_ERROR', 'Use application/x-ndjson for question imports');
    }
    const report = await this.service.importQuestions(params.quizId ?? '', req);
    res.status(200).json(success(report));
  });

  readonly exportQuestions = asyncHandler(async (req, res, next) => {
    const params = res.locals.params as Params;
    const query = res.locals.query as ExportQuery;
    try {
      const cursor = await this.service.questionExportCursor(params.quizId ?? '');
      await streamCursorToResponse(req, res, cursor, {
        filename: `questions-${params.quizId}`,
        format: query.format,
        ...(query.compress ? { compress: query.compress } : {}),
        columns: QUESTION_EXPORT_COLUMNS
      });
    } catch (error: unknown) {
      this.forwardStreamError(error, req, res, next);
    }
  });

  readonly exportAttempts = asyncHandler(async (req, res, next) => {
    const params = res.locals.params as Params;
    const query = res.locals.query as ExportQuery;
    try {
      await this.service.ensureQuizExists(params.quizId ?? '');
      if (!this.attempts) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Attempt export is not available yet');
      const cursor = this.attempts.findByQuizCursor(params.quizId ?? '');
      await streamCursorToResponse(req, res, cursor, {
        filename: `attempts-${params.quizId}`,
        format: query.format,
        ...(query.compress ? { compress: query.compress } : {}),
        fallbackColumns: ATTEMPT_EXPORT_COLUMNS
      });
    } catch (error: unknown) {
      this.forwardStreamError(error, req, res, next);
    }
  });

  private forwardStreamError(error: unknown, req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) {
      if (!res.destroyed) res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    if (req.destroyed || res.destroyed) return;
    next(error);
  }
}
