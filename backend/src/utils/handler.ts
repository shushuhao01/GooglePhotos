import { Request, Response, NextFunction } from 'express';
import { ok, fail } from './response.js';

/* 把 async handler 包装成 express 可捕获错误的中间件 */
export function handler(fn: (req: any, res: any) => any) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as any, res as any)).catch(next);
  };
}

export function asyncHandler(fn: (req: any, res: any) => any) {
  return handler(fn);
}
