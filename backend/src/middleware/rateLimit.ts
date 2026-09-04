import { Request, Response, NextFunction } from 'express';
import { fail } from '../utils/response.js';

/* 内存限流：管理后台无 Redis 时可用的简化实现；生产可替换为 Redis */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(options: { windowMs: number; max: number; keyPrefix?: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${options.keyPrefix || 'rl'}:${req.ip}:${req.path}`;
    const b = buckets.get(key);
    if (!b || b.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    b.count += 1;
    if (b.count > options.max) return fail(res, 429, 'RATE_LIMITED', '请求过于频繁，请稍后再试');
    return next();
  };
}
