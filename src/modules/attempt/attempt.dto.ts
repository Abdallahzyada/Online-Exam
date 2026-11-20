import { z } from 'zod';
import { objectIdSchema } from '../dashboard/dashboard.dto.js';
import { MAX_QUESTIONS_PER_ATTEMPT } from '../dashboard/analytics-limits.js';

// The attempt size limit is shared with Dashboard analytics so every stored
// attempt can also be analysed without hitting the per-attempt limit.
export { MAX_QUESTIONS_PER_ATTEMPT };
export const SUBMIT_GRACE_MS = 10_000;
export const STALE_CLAIM_MS = 60_000;
export const MAX_OPTIONS_PER_QUESTION = 50;
export const DEFAULT_PASSING_SCORE_PERCENTAGE = 50;

export const ATTEMPT_STATUSES = ['IN_PROGRESS', 'SUBMITTING', 'SUBMITTED', 'EXPIRED'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export type FinalAttemptStatus = Extract<AttemptStatus, 'SUBMITTED' | 'EXPIRED'>;
export const QUESTION_TYPES = ['single', 'multi'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const optionIdSchema = z.string().min(1).max(64);
const optionSchema = z.object({ optionId: optionIdSchema, text: z.string().max(2000) });

// BR-08 and BR-09: the snapshot copied onto an attempt must have a usable answer key.
export const questionSnapshotSchema = z.object({
  questionId: objectIdSchema,
  text: z.string().min(1).max(5000),
  type: z.enum(QUESTION_TYPES),
  options: z.array(optionSchema).min(2).max(MAX_OPTIONS_PER_QUESTION),
  points: z.number().int().positive(),
  correctOptionIds: z.array(optionIdSchema).min(1)
}).superRefine((question, context) => {
  const optionIds = question.options.map(option => option.optionId);
  const known = new Set(optionIds);
  const correct = new Set(question.correctOptionIds);
  if (known.size !== optionIds.length) context.addIssue({ code: 'custom', path: ['options'], message: 'Option IDs must be unique' });
  if (correct.size !== question.correctOptionIds.length) context.addIssue({ code: 'custom', path: ['correctOptionIds'], message: 'Correct option IDs must be unique' });
  if (question.type === 'single' && correct.size !== 1) context.addIssue({ code: 'custom', path: ['correctOptionIds'], message: 'Single choice needs exactly one correct option' });
  if (![...correct].every(optionId => known.has(optionId))) context.addIssue({ code: 'custom', path: ['correctOptionIds'], message: 'Correct option IDs must exist in options' });
});
export type QuestionSnapshot = z.infer<typeof questionSnapshotSchema>;
export type QuestionOption = QuestionSnapshot['options'][number];

export const quizParamsSchema = z.object({ quizId: objectIdSchema }).strict();
export const attemptParamsSchema = z.object({ attemptId: objectIdSchema }).strict();
export const emptyQuerySchema = z.object({}).strict();
export const submitAttemptSchema = z.object({
  answers: z.array(z.object({
    questionId: objectIdSchema,
    selectedOptionIds: z.array(optionIdSchema).max(MAX_OPTIONS_PER_QUESTION)
  }).strict()).max(MAX_QUESTIONS_PER_ATTEMPT)
}).strict();
export type QuizParams = z.infer<typeof quizParamsSchema>;
export type AttemptParams = z.infer<typeof attemptParamsSchema>;
export type SubmitAttemptBody = z.infer<typeof submitAttemptSchema>;
export type SubmittedAnswer = SubmitAttemptBody['answers'][number];

export interface StartAttemptQuestion {
  readonly questionId: string;
  readonly text: string;
  readonly type: QuestionType;
  readonly points: number;
  readonly options: readonly QuestionOption[];
}
export interface StartAttemptResponse {
  readonly attemptId: string;
  readonly quizTitle: string;
  readonly durationMinutes: number;
  readonly startedAt: string;
  readonly expiresAt: string;
  readonly questions: readonly StartAttemptQuestion[];
}
export interface ScoreSummary {
  readonly scorePercentage: number;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly earnedPoints: number;
  readonly totalPoints: number;
  readonly passed: boolean;
  readonly timeSpentSeconds: number;
}
export interface SubmitAttemptResponse extends ScoreSummary {
  readonly attemptId: string;
}
export interface ReviewQuestion {
  readonly questionId: string;
  readonly text: string;
  readonly type: QuestionType;
  readonly options: readonly QuestionOption[];
  readonly selectedOptionIds: readonly string[];
  readonly correctOptionIds: readonly string[];
  readonly isCorrect: boolean;
  readonly pointsEarned: number;
  readonly maxPoints: number;
}
export interface AttemptReviewResponse extends ScoreSummary {
  readonly attemptId: string;
  readonly quizId: string;
  readonly quizTitle: string;
  readonly status: FinalAttemptStatus;
  readonly submittedAt: string;
  readonly questions: readonly ReviewQuestion[];
}
