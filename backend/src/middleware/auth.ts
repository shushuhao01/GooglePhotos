import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { fail } from '../utils/response.js';

export interface AuthUser {
  id: number;
  email: string;
  admin: boolean;
}
export interface AuthRequest extends Request {
  user?: AuthUser;
}

/* 产品账号令牌鉴权（用户端与管理端共用） */
export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return fail(res, 401, 'UNAUTHENTICATED', '未登录');
  try {
    const p = verifyToken(h.slice(7));
    req.user = { id: p.sub, email: p.email, admin: p.admin };
    next();
  } catch {
    return fail(res, 401, 'TOKEN_INVALID', '登录已过期，请重新登录');
  }
}

export function adminAuth(req: AuthRequest, res: Response, next: NextFunction) {
  auth(req, res, () => {
    if (!req.user?.admin) return fail(res, 403, 'FORBIDDEN', '需要管理员权限');
    next();
  });
}
