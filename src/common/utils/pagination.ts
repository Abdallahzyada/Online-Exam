import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10)
}).strict();
export type Pagination = z.infer<typeof paginationSchema>;
