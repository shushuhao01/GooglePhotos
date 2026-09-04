import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { billingService, deleteAccountData } from '../services/BillingService.js';
import { handler } from '../utils/handler.js';
import { ok } from '../utils/response.js';

const r = Router();

/* 创建支付订单 */
r.post('/billing/checkout', auth, handler(async (req, res) => {
  const d = await billingService.createCheckout(req.user!.id, String(req.body?.planCode || ''), String(req.body?.provider || 'mock'), String(req.body?.idempotencyKey || ''));
  return ok(res, d);
}));

/* Mock 支付（开发） */
r.post('/billing/mock-pay/:orderNo', auth, handler(async (req, res) => {
  const d = await billingService.mockPay(req.user!.id, req.params.orderNo);
  return ok(res, d);
}));

/* 用户订单列表 */
r.get('/billing/orders', auth, handler(async (req, res) => {
  const orders = await billingService.orders(req.user!.id);
  return ok(res, { orders });
}));

/* 订单详情 */
r.get('/billing/orders/:orderNo', auth, handler(async (req, res) => {
  const order = await billingService.orderDetail(req.user!.id, req.params.orderNo);
  return ok(res, { order });
}));

/* 主动查单 */
r.post('/billing/orders/:orderNo/reconcile', auth, handler(async (req, res) => {
  const order = await billingService.reconcile(req.params.orderNo);
  return ok(res, { order });
}));

/* 退款 */
r.post('/billing/refund', auth, handler(async (req, res) => {
  const d = await billingService.refund(req.user!.id, String(req.body?.orderNo || ''), Number(req.body?.cents || 0), String(req.body?.reason || ''));
  return ok(res, d);
}));

/* 支付平台 Webhook（无需登录令牌，靠验签） */
r.post('/billing/webhooks/:provider', handler(async (req, res) => {
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), (Array.isArray(v) ? v.join(',') : (v as string))]));
  const rawBody = JSON.stringify(req.body || {});
  const d = await billingService.handleWebhook(req.params.provider, headers as Record<string, string | undefined>, rawBody);
  return ok(res, d);
}));

/* 删除账号 */
r.delete('/account', auth, handler(async (req, res) => {
  const d = await deleteAccountData(req.user!.id);
  return ok(res, d);
}));

export default r;
