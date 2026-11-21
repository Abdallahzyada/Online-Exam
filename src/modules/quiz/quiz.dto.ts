import { z } from "zod";
import { httpUrl } from "../../common/utils/http-url.js";
import { paginationSchema } from "../../common/utils/pagination.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid MongoDB ID");

const quizFields = {
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(2000),
  imageUrl: httpUrl,
  category: z.string().trim().min(1).max(80),
  durationMinutes: z.number().int().min(1),
  passingScorePercentage: z.number().int().min(0).max(100).default(50),
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
    passingScorePercentage: z.number().int().min(0).max(100).optional(),
    instructions: z.array(z.string().trim().min(1).max(500)).optional(),
    // Publish / unpublish goes through the same PATCH (spec: "edit, publish (isPublished)").
    isPublished: z.boolean().optional()
  }).strict().refine(value => Object.keys(value).length > 0, "At least one field is required")
});

export const quizIdSchema = z.object({
  params: z.object({ quizId: objectId })
});

export const diplomaQuizzesSchema = z.object({
  params: z.object({ diplomaId: objectId }),
  query: z.object({
    page: paginationSchema.shape.page,
    limit: paginationSchema.shape.limit,
    search: z.string().trim().max(120).optional(),
    category: z.string().trim().min(1).max(80).optional()
  })
});

export type CreateQuizInput = z.infer<typeof createQuizSchema>["body"];
export type UpdateQuizInput = z.infer<typeof updateQuizSchema>["body"];

interface QuizLike {
  _id: unknown;
  diplomaId: unknown;
  title: string;
  description: string;
  imageUrl: string;
  category: string;
  durationMinutes: number;
  questionsCount: number;
  passingScorePercentage: number;
  totalPoints: number;
  instructions: string[];
  isPublished: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Public shape of a Quiz (no Mongoose internals, never any answer key). */
export function toQuizDto(quiz: QuizLike) {
  return {
    id: String(quiz._id),
    diplomaId: String(quiz.diplomaId),
    title: quiz.title,
    description: quiz.description,
    imageUrl: quiz.imageUrl,
    category: quiz.category,
    durationMinutes: quiz.durationMinutes,
    questionsCount: quiz.questionsCount,
    passingScorePercentage: quiz.passingScorePercentage,
    totalPoints: quiz.totalPoints,
    instructions: [...quiz.instructions],
    isPublished: quiz.isPublished,
    createdAt: quiz.createdAt,
    updatedAt: quiz.updatedAt
  };
}
