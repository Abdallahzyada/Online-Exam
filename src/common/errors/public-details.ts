import { z } from 'zod';

const issueCodeSchema = z.enum(['invalid_type', 'invalid_value', 'too_small', 'too_big', 'invalid_format', 'custom', 'unrecognized_keys']);
export interface PublicErrorDetail {
  readonly path: string;
  readonly code: z.infer<typeof issueCodeSchema>;
}
const detailSchema = z.object({ path: z.string().max(128).regex(/^[a-zA-Z0-9_.\[\]-]*$/), code: issueCodeSchema });
export function publicErrorDetails(details: unknown) {
  if (!Array.isArray(details)) return [];
  return details.slice(0, 100).flatMap((detail: unknown) => {
    const parsed = detailSchema.safeParse(detail);
    return parsed.success ? [{ ...parsed.data, message: 'Invalid field value' }] : [];
  });
}
