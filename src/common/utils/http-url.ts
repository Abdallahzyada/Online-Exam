import { z } from "zod";

/** Image/link URL that must use http(s) only (rejects javascript:, ftp:, data: ...). */
export const httpUrl = z
  .string()
  .trim()
  .url()
  .refine(value => /^https?:\/\//i.test(value), "URL must start with http:// or https://");
