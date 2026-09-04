import { Router } from 'express';
import { authService, verifyAdminCredential } from '../services/AuthService.js';
import { auth } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { ok } from '../utils/response.js';

const r = Router();

/* 管理员后台账号+密码登录（admin/admin123，可在系统设置修改） */
r.post('/auth/admin-login', handler(async (req, res) => {
  const d = await authService.adminLogin(String(req.body.username || ''), String(req.body.password || ''));
  return ok(res, d);
}));

/* 开发环境邮箱登录（生产仅对管理员邮箱开放） */
r.post('/auth/dev-login', handler(async (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  const email = String(req.body.email || '').trim().toLowerCase();
  if (isProd) {
    const allowed = await authService.isAdminEmail(email);
    if (!allowed) return res.status(404).json({ ok: false, code: 'NOT_FOUND' });
  }
  const d = await authService.devLogin(email);
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
