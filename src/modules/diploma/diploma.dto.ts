import { z } from "zod";
import { httpUrl } from "../../common/utils/http-url.js";
import { paginationSchema } from "../../common/utils/pagination.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid MongoDB ID");

export const createDiplomaSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().min(1).max(2000),
    imageUrl: httpUrl
  }).strict()
});

export const updateDiplomaSchema = z.object({
  params: z.object({ diplomaId: objectId }),
  body: z.object({
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    imageUrl: httpUrl.optional()
  }).strict().refine(value => Object.keys(value).length > 0, "At least one field is required")
});

export const diplomaIdSchema = z.object({
  params: z.object({ diplomaId: objectId })
});

export const listDiplomasSchema = z.object({
  query: z.object({
    page: paginationSchema.shape.page,
    limit: paginationSchema.shape.limit,
    search: z.string().trim().max(120).optional(),
    includeInactive: z.enum(["true", "false"]).optional()
  })
});

export type CreateDiplomaInput = z.infer<typeof createDiplomaSchema>["body"];
export type UpdateDiplomaInput = z.infer<typeof updateDiplomaSchema>["body"];

interface DiplomaLike {
  _id: unknown;
  title: string;
  description: string;
  imageUrl: string;
  isActive: boolean;
  quizzesCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Public shape of a Diploma (no Mongoose internals). */
export function toDiplomaDto(diploma: DiplomaLike) {
  return {
    id: String(diploma._id),
    title: diploma.title,
    description: diploma.description,
    imageUrl: diploma.imageUrl,
    isActive: diploma.isActive,
    quizzesCount: diploma.quizzesCount,
    createdAt: diploma.createdAt,
    updatedAt: diploma.updatedAt
  };
}
