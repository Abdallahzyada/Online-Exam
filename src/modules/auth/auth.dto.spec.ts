
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyResetCodeSchema,
  resetPasswordSchema
} from './auth.dto.js';

describe('Auth DTO schemas', () => {
  describe('registerSchema', () => {
    const validData = {
      firstName: 'Ayman',
      lastName: 'Mohamed',
      email: '  AYMAN@EXAMPLE.COM ',
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!'
    };

    it('should accept valid registration data', () => {
      expect(registerSchema.safeParse(validData).success).toBe(true);
    });

    it('should normalize the email', () => {
      const result = registerSchema.parse(validData);

      expect(result.email).toBe('ayman@example.com');
    });

    it('should reject passwords that do not match', () => {
      const result = registerSchema.safeParse({
        ...validData,
        confirmPassword: 'DifferentPass123!'
      });

      expect(result.success).toBe(false);
    });

    it('should reject weak passwords', () => {
      const result = registerSchema.safeParse({
        ...validData,
        password: 'weak',
        confirmPassword: 'weak'
      });

      expect(result.success).toBe(false);
    });

    it('should ignore a client-supplied role', () => {
      const result = registerSchema.parse({
        ...validData,
        role: 'admin'
      });

      expect(result).not.toHaveProperty('role');
    });

    it('should reject invalid email addresses', () => {
      const result = registerSchema.safeParse({
        ...validData,
        email: 'not-an-email'
      });

      expect(result.success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('should accept valid login data', () => {
      expect(
        loginSchema.safeParse({
          email: 'ayman@example.com',
          password: 'anything'
        }).success
      ).toBe(true);
    });

    it('should reject missing passwords', () => {
      expect(
        loginSchema.safeParse({
          email: 'ayman@example.com',
          password: ''
        }).success
      ).toBe(false);
    });
  });

  describe('forgotPasswordSchema', () => {
    it('should accept a valid email', () => {
      expect(
        forgotPasswordSchema.safeParse({
          email: 'ayman@example.com'
        }).success
      ).toBe(true);
    });
  });

  describe('verifyResetCodeSchema', () => {
    it('should accept a six-digit code', () => {
      expect(
        verifyResetCodeSchema.safeParse({
          email: 'ayman@example.com',
          code: '123456'
        }).success
      ).toBe(true);
    });

    it('should reject codes that are not six digits', () => {
      expect(
        verifyResetCodeSchema.safeParse({
          email: 'ayman@example.com',
          code: '12345'
        }).success
      ).toBe(false);
    });
  });

  describe('resetPasswordSchema', () => {
    const validData = {
      email: 'ayman@example.com',
      newPassword: 'NewStrongPass123!',
      confirmPassword: 'NewStrongPass123!'
    };

    it('should accept valid reset data', () => {
      expect(resetPasswordSchema.safeParse(validData).success).toBe(true);
    });

    it('should reject mismatching passwords', () => {
      expect(
        resetPasswordSchema.safeParse({
          ...validData,
          confirmPassword: 'DifferentPass123!'
        }).success
      ).toBe(false);
    });
  });
});
