import { Response } from 'express';
import { randomUUID } from 'node:crypto';

/* 统一响应 { ok, code, message, requestId } */
export function ok(res: Response, data: Record<string, unknown> | unknown[] = {}, message = 'ok') {
  const requestId = randomUUID().slice(0, 8);
  return res.json({ ok: true, code: 'OK', message, requestId, ...(Array.isArray(data) ? { data } : data) });
}

export function fail(res: Response, status: number, code: string, message = '', extra?: Record<string, unknown>) {
  const requestId = randomUUID().slice(0, 8);
  return res.status(status).json({ ok: false, code, message, requestId, ...(extra || {}) });
}

export class AppError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown> | undefined;
  constructor(status: number, code: string, message = '', details?: Record<string, unknown>) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/* 常用错误快捷 */
export const BadRequest = (message = '', details?: Record<string, unknown>) => new AppError(400, 'BAD_REQUEST', message, details);
export const Unauthorized = (message = '') => new AppError(401, 'UNAUTHENTICATED', message);
export const Forbidden = (message = '') => new AppError(403, 'FORBIDDEN', message);
export const NotFound = (message = '') => new AppError(404, 'NOT_FOUND', message);
export const QuotaExceeded = (message = '额度不足') => new AppError(402, 'QUOTA_EXCEEDED', message);
export const TooMany = (message = '请求过于频繁') => new AppError(429, 'RATE_LIMITED', message);
