import { Request, Response, NextFunction } from 'express';
import { AppError, fail } from '../utils/response.js';
import { logger } from '../config/logger.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return fail(res, err.status, err.code, err.message, err.details);
  }
  logger.error('unhandled error', { error: (err as Error)?.message, stack: (err as Error)?.stack });
  return fail(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
}

export function notFoundHandler(_req: Request, res: Response) {
  return fail(res, 404, 'NOT_FOUND', '接口不存在');
}
