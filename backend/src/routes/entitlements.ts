import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { entitlementService } from '../services/EntitlementService.js';
import { handler } from '../utils/handler.js';
import { ok } from '../utils/response.js';
import { randomBytes } from 'node:crypto';

const r = Router();

/* 查询当前权益 */
r.get('/entitlements/status', auth, handler(async (req, res) => {
  const s = await entitlementService.status(req.user!.id);
  return ok(res, { entitlement: s });
}));

/* 预扣一次任务额度 */
r.post('/entitlements/reserve', auth, handler(async (req, res) => {
  const op = String(req.body?.operation || '');
  const reqId = 'RES_' + randomBytes(8).toString('hex');
  const d = await entitlementService.reserve(req.user!.id, op as any, reqId);
  return ok(res, d);
}));

/* 确认扣除 */
r.post('/entitlements/commit', auth, handler(async (req, res) => {
  const d = await entitlementService.commit(req.user!.id, String(req.body?.operation || '') as any, String(req.body?.reservation || ''));
  return ok(res, d);
}));

/* 退回额度（服务端错误） */
r.post('/entitlements/release', auth, handler(async (req, res) => {
  const d = await entitlementService.release(req.user!.id, String(req.body?.operation || '') as any, String(req.body?.reservation || ''));
  return ok(res, d);
}));

export default r;
