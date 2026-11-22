import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .transform((value) => value.toLowerCase())
  .pipe(z.email());

const passwordSchema = z
  .string()
  .min(8, 'Password must contain at least 8 characters')
  .max(128, 'Password is too long')
  .refine(
    (password) => Buffer.byteLength(password, 'utf8') <= 72,
    'Password must not exceed 72 UTF-8 bytes'
  )
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/,
    'Password must contain uppercase, lowercase, numeric, and special characters'
  );

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(2).max(80),
    lastName: z.string().trim().min(2).max(80),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    phone: z.string().trim().min(7).max(20).optional(),
    avatarUrl: z.url().optional()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword']
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1)
    .max(128)
    .refine(
      (password) => Buffer.byteLength(password, 'utf8') <= 72,
      'Invalid credentials'
    )
});

export const forgotPasswordSchema = z.object({
  email: emailSchema
});

export const verifyResetCodeSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, 'Code must contain exactly 6 digits')
});

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    resetToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    newPassword: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword']
  });

export type RegisterDTO = z.infer<typeof registerSchema>;
export type LoginDTO = z.infer<typeof loginSchema>;
export type ForgotPasswordDTO = z.infer<typeof forgotPasswordSchema>;
export type VerifyResetCodeDTO = z.infer<typeof verifyResetCodeSchema>;
export type ResetPasswordDTO = z.infer<typeof resetPasswordSchema>;

export interface AuthUserDTO {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: 'student' | 'admin';
  phone?: string;
  avatarUrl?: string;
}

export interface AuthTokenResponse {
  accessToken: string;
  user: AuthUserDTO;
}