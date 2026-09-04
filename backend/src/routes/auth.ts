import { Router } from 'express';
import { authService } from '../services/AuthService.js';
import { auth } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { ok } from '../utils/response.js';

const r = Router();

/* 开发环境邮箱登录（生产关闭） */
r.post('/auth/dev-login', handler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ ok: false, code: 'NOT_FOUND' });
  const d = await authService.devLogin(String(req.body.email || ''));
  return ok(res, d);
}));

/* 注册（邮箱+密码） */
r.post('/auth/register', handler(async (req, res) => {
  const d = await authService.register(String(req.body.email || ''), String(req.body.password || ''), String(req.body.displayName || ''), req.ip);
  return ok(res, d);
}));

/* 登录（邮箱+密码） */
r.post('/auth/login', handler(async (req, res) => {
  const d = await authService.login(String(req.body.email || ''), String(req.body.password || ''));
  return ok(res, d);
}));

/* 当前账号 */
r.get('/me', auth, handler(async (req, res) => {
  const u = await authService.getMe(req.user!.id);
  return ok(res, { user: u });
}));

export default r;
