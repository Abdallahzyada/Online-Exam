import { validateRequest } from '../../common/middlewares/validate-request.js';
import { attemptParamsSchema, emptyQuerySchema, quizParamsSchema, submitAttemptSchema } from './attempt.dto.js';
import type { AttemptParams, QuizParams, SubmitAttemptBody } from './attempt.dto.js';

export interface AttemptLocals {
  quizParams?: QuizParams;
  attemptParams?: AttemptParams;
  submission?: SubmitAttemptBody;
}

export const validateQuizParams = validateRequest(quizParamsSchema, 'params', 'quizParams');
export const validateAttemptParams = validateRequest(attemptParamsSchema, 'params', 'attemptParams');
export const validateEmptyQuery = validateRequest(emptyQuerySchema, 'query', 'query');
export const validateSubmission = validateRequest(submitAttemptSchema, 'body', 'submission');
