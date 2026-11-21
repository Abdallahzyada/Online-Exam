import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid MongoDB ID");

export const createDiplomaSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().min(1).max(2000),
    imageUrl: z.string().url()
  }).strict()
});

export const updateDiplomaSchema = z.object({
  params: z.object({ diplomaId: objectId }),
  body: z.object({
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    imageUrl: z.string().url().optional()
  }).strict().refine(value => Object.keys(value).length > 0, "At least one field is required")
});

export const diplomaIdSchema = z.object({
  params: z.object({ diplomaId: objectId })
});

export const listDiplomasSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
    search: z.string().trim().max(120).optional(),
    includeInactive: z.enum(["true", "false"]).optional()
  })
});

export type CreateDiplomaInput = z.infer<typeof createDiplomaSchema>["body"];
export type UpdateDiplomaInput = z.infer<typeof updateDiplomaSchema>["body"];
