import type { Response } from 'express';
import { asyncHandler } from '../../common/middlewares/async-handler.js';
import { success } from '../../common/utils/response-envelope.js';
import type { AttemptAuth } from './attempt.ports.js';
import type { AttemptService } from './attempt.service.js';
import type { AttemptLocals } from './attempt.validation.js';

function local<K extends keyof AttemptLocals>(res: Response, key: K): NonNullable<AttemptLocals[K]> {
  const value = (res.locals as AttemptLocals)[key];
  if (!value) throw new Error(`Validation middleware for ${key} is missing`);
  return value as NonNullable<AttemptLocals[K]>;
}

export class AttemptController {
  constructor(private readonly service: AttemptService, private readonly auth: AttemptAuth) {}

  start = asyncHandler(async (req, res) => {
    const { quizId } = local(res, 'quizParams');
    res.status(201).json(success(await this.service.startAttempt(this.auth.studentId(req), quizId)));
  });

  submit = asyncHandler(async (req, res) => {
    const { attemptId } = local(res, 'attemptParams');
    const { answers } = local(res, 'submission');
    res.status(200).json(success(await this.service.submitAttempt(this.auth.studentId(req), attemptId, answers)));
  });

  review = asyncHandler(async (req, res) => {
    const { attemptId } = local(res, 'attemptParams');
    res.status(200).json(success(await this.service.reviewAttempt(this.auth.studentId(req), attemptId)));
  });
}
