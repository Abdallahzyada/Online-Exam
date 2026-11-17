import type { Request, RequestHandler } from 'express';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';

export const sessionSchema = z.object({
  role: z.enum(['student', 'admin']), tokenVersion: z.number().int().nonnegative()
});
const claimsSchema = sessionSchema.extend({
  sub: z.string().regex(/^[a-f\d]{24}$/i), exp: z.number().int().positive()
});
export type UserSession = z.infer<typeof sessionSchema>;
export type Role = UserSession['role'];
export type AccessClaims = z.infer<typeof claimsSchema>;
export interface SessionReader { findSession(userId: string): Promise<UserSession | null> }
export interface TokenVerifier { verify(token: string): Promise<AccessClaims> }

export class JwtVerifier implements TokenVerifier {
  private readonly key: Uint8Array;
  constructor(secret: string) { this.key = new TextEncoder().encode(secret); }

  async verify(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'], requiredClaims: ['sub', 'exp'] });
      return claimsSchema.parse(payload);
    } catch { throw new UnauthorizedError(); }
  }
}

export function createAuth(verifier: TokenVerifier, sessions: SessionReader) {
  const identities = new WeakMap<Request, AccessClaims>();
  const authenticate: RequestHandler = async (req, _res, next) => {
    try {
      const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
      const token = match?.[1];
      if (!token) throw new UnauthorizedError();
      const claims = await verifier.verify(token);
      const session = await sessions.findSession(claims.sub);
      if (!session || session.tokenVersion !== claims.tokenVersion || session.role !== claims.role) {
        throw new UnauthorizedError();
      }
      identities.set(req, claims);
      next();
    } catch (error: unknown) { next(error); }
  };
  function principal(req: Request): AccessClaims {
    const identity = identities.get(req);
    if (!identity) throw new UnauthorizedError();
    return identity;
  }
  function requireRole(role: Role): RequestHandler {
    return (req, _res, next) => {
      try {
        if (principal(req).role !== role) throw new ForbiddenError();
        next();
      } catch (error: unknown) { next(error); }
    };
  }
  return {
    authenticate, principal, requireRole,
    requireStudent: requireRole('student'), requireAdmin: requireRole('admin'),
    studentId: (req: Request) => principal(req).sub
  };
}
