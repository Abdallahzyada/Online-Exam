import { z } from 'zod';

const optionSchema = z.object({
  optionId: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1).max(2_000)
}).strict();

export const questionSchema = z.object({
  type: z.enum(['single', 'multi']),
  text: z.string().trim().min(1).max(10_000),
  options: z.array(optionSchema).min(2).max(100),
  correctOptionIds: z.array(z.string().trim().min(1).max(64)).min(1).max(100),
  points: z.number().int().positive().max(1_000_000).default(1)
}).strict().superRefine((question, context) => {
  const optionIds = question.options.map(option => option.optionId);
  const uniqueOptionIds = new Set(optionIds);
  if (uniqueOptionIds.size !== optionIds.length) {
    context.addIssue({ code: 'custom', path: ['options'], message: 'Option IDs must be unique' });
  }

  const uniqueCorrectIds = new Set(question.correctOptionIds);
  if (uniqueCorrectIds.size !== question.correctOptionIds.length) {
    context.addIssue({ code: 'custom', path: ['correctOptionIds'], message: 'Correct option IDs must be unique' });
  }

  if (question.correctOptionIds.some(id => !uniqueOptionIds.has(id))) {
    context.addIssue({ code: 'custom', path: ['correctOptionIds'], message: 'Every correct option must exist in options' });
  }

  if (question.type === 'single' && question.correctOptionIds.length !== 1) {
    context.addIssue({ code: 'custom', path: ['correctOptionIds'], message: 'Single-choice questions require exactly one correct option' });
  }
});

export const questionUpdateSchema = z.object({
  type: z.enum(['single', 'multi']).optional(),
  text: z.string().trim().min(1).max(10_000).optional(),
  options: z.array(optionSchema).min(2).max(100).optional(),
  correctOptionIds: z.array(z.string().trim().min(1).max(64)).min(1).max(100).optional(),
  points: z.number().int().positive().max(1_000_000).optional()
}).strict().refine(value => Object.keys(value).length > 0, 'At least one field must be provided');

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Expected a 24-character MongoDB ObjectId');

export const quizParamsSchema = z.object({ quizId: objectIdSchema }).strict();
export const questionParamsSchema = z.object({ questionId: objectIdSchema }).strict();
export const exportQuerySchema = z.object({
  format: z.enum(['ndjson', 'csv']).default('ndjson'),
  compress: z.enum(['gzip']).optional()
}).strict();

/** Validated + defaulted output: points is always present (default=1 applied). Used by repository/service. */
export type QuestionInput = z.output<typeof questionSchema>;
/** Raw client input: points may be omitted (Zod will apply the default). Used in route body documentation. */
export type QuestionRawInput = z.input<typeof questionSchema>;
export type QuestionPatch = z.infer<typeof questionUpdateSchema>;
export type QuestionType = QuestionInput['type'];
export type QuestionOption = QuestionInput['options'][number];

export interface QuestionDto {
  readonly id: string;
  readonly quizId: string;
  readonly type: QuestionType;
  readonly text: string;
  readonly options: readonly QuestionOption[];
  readonly correctOptionIds: readonly string[];
  readonly points: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toQuestionDto(document: {
  readonly _id: { toString(): string } | string;
  readonly quizId: { toString(): string } | string;
  readonly type: QuestionType;
  readonly text: string;
  readonly options: readonly QuestionOption[];
  readonly correctOptionIds: readonly string[];
  readonly points: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): QuestionDto {
  return {
    id: document._id.toString(),
    quizId: document.quizId.toString(),
    type: document.type,
    text: document.text,
    options: document.options,
    correctOptionIds: document.correctOptionIds,
    points: document.points,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

export function questionInputFromDocument(document: {
  readonly type: QuestionType;
  readonly text: string;
  readonly options: readonly QuestionOption[];
  readonly correctOptionIds: readonly string[];
  readonly points: number;
}): QuestionInput {
  return questionSchema.parse({
    type: document.type,
    text: document.text,
    options: document.options,
    correctOptionIds: document.correctOptionIds,
    points: document.points
  });
}
