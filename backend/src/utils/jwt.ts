import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface TokenPayload {
  sub: number;
  email: string;
  admin: boolean;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign({ sub: payload.sub, email: payload.email, admin: payload.admin }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as any,
  });
}

export function verifyToken(token: string): TokenPayload {
  const p = jwt.verify(token, env.jwtSecret) as unknown as { sub: number; email: string; admin: boolean };
  return { sub: Number(p.sub), email: String(p.email), admin: !!p.admin };
}

export function hashToken(raw: string): string {
  return jwt.sign({ jti: raw }, env.jwtSecret, { expiresIn: '1d' as any });
}
