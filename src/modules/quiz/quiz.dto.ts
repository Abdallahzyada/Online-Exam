import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid MongoDB ID");

const quizFields = {
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(2000),
  imageUrl: z.string().url(),
  category: z.string().trim().min(1).max(80),
  durationMinutes: z.number().int().min(1),
  passingScorePercentage: z.number().min(0).max(100).default(50),
  instructions: z.array(z.string().trim().min(1).max(500)).default([])
};

export const createQuizSchema = z.object({
  params: z.object({ diplomaId: objectId }),
  body: z.object(quizFields).strict()
});

export const updateQuizSchema = z.object({
  params: z.object({ quizId: objectId }),
  body: z.object({
    title: quizFields.title.optional(),
    description: quizFields.description.optional(),
    imageUrl: quizFields.imageUrl.optional(),
    category: quizFields.category.optional(),
    durationMinutes: quizFields.durationMinutes.optional(),
    passingScorePercentage: z.number().min(0).max(100).optional(),
    instructions: z.array(z.string().trim().min(1).max(500)).optional()
  }).strict().refine(value => Object.keys(value).length > 0, "At least one field is required")
});

export const quizIdSchema = z.object({
  params: z.object({ quizId: objectId })
});

export const diplomaQuizzesSchema = z.object({
  params: z.object({ diplomaId: objectId }),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10)
  })
});

export const publishQuizSchema = z.object({
  params: z.object({ quizId: objectId }),
  body: z.object({ isPublished: z.boolean() }).strict()
});

export type CreateQuizInput = z.infer<typeof createQuizSchema>["body"];
export type UpdateQuizInput = z.infer<typeof updateQuizSchema>["body"];
