import { Router } from 'express';
import { adminAuth } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { ok } from '../utils/response.js';
import { AppDataSource } from '../config/database.js';
import { Plan } from '../entities/Plan.js';
import { PaymentChannel } from '../entities/PaymentChannel.js';
import { Order } from '../entities/Order.js';
import { userAdminService, systemConfigService, riskService, auditService } from '../services/AdminService.js';
import { providerFor, PROVIDERS } from '../payments/index.js';
import { encryptConfig, decryptConfig } from '../utils/cryptoConfig.js';
import { billingService } from '../services/BillingService.js';

const r = Router();
const planRepo = () => AppDataSource.getRepository(Plan);
const channelRepo = () => AppDataSource.getRepository(PaymentChannel);
const orderRepo = () => AppDataSource.getRepository(Order);

/* ---------- 套餐 ---------- */
r.get('/admin/plans', adminAuth, handler(async (_req, res) => {
  const plans = await planRepo().find({ order: { priceCents: 'ASC' } });
  return ok(res, { plans });
}));

r.post('/admin/plans', adminAuth, handler(async (req, res) => {
  const b = req.body || {};
  await planRepo().save({
    code: String(b.code), name: String(b.name), currency: String(b.currency || 'CNY'),
    priceCents: Math.max(0, Number(b.priceCents || 0)), billingPeriod: b.billingPeriod || 'month',
    uploadQuota: Number(b.uploadQuota || 0), downloadQuota: Number(b.downloadQuota || 0), zipQuota: Number(b.zipQuota || 0),
    maxItems: Number(b.maxItems || 10), maxBytes: Number(b.maxBytes || 209715200),
    concurrency: Number(b.concurrency || 1), trialDays: Number(b.trialDays || 0),
    refundPolicy: b.refundPolicy || null, isActive: b.isActive === false ? false : true,
  });
  return ok(res);
}));

r.put('/admin/plans/:code', adminAuth, handler(async (req, res) => {
  const b = req.body || {};
  await planRepo().update({ code: req.params.code }, {
    name: String(b.name), priceCents: Math.max(0, Number(b.priceCents || 0)),
    billingPeriod: b.billingPeriod || 'month', uploadQuota: Number(b.uploadQuota || 0),
    downloadQuota: Number(b.downloadQuota || 0), zipQuota: Number(b.zipQuota || 0),
    maxItems: Number(b.maxItems || 10), maxBytes: Number(b.maxBytes || 209715200),
    concurrency: Number(b.concurrency || 1), trialDays: Number(b.trialDays || 0),
    refundPolicy: b.refundPolicy || null, isActive: b.isActive === false ? false : true,
  });
  return ok(res);
}));

r.delete('/admin/plans/:code', adminAuth, handler(async (req, res) => {
  await planRepo().update({ code: req.params.code }, { isActive: false });
  return ok(res);
}));

/* ---------- 用户 ---------- */
r.get('/admin/users', adminAuth, handler(async (req, res) => {
  const users = await userAdminService.list(Number(req.query.limit || 50));
  return ok(res, { users });
}));

r.get('/admin/users/:id', adminAuth, handler(async (req, res) => {
  const d = await userAdminService.detail(Number(req.params.id));
  return ok(res, d);
}));

r.put('/admin/users/:id/status', adminAuth, handler(async (req, res) => {
  const d = await userAdminService.setStatus(Number(req.params.id), req.body?.status as any);
  return ok(res, d);
}));

r.post('/admin/users/:id/grant', adminAuth, handler(async (req, res) => {
  const d = await userAdminService.adjustQuota(Number(req.params.id), String(req.body?.planCode || 'free'));
  return ok(res, d);
}));

/* ---------- 订单 ---------- */
r.get('/admin/orders', adminAuth, handler(async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit || 100));
  const rows = await orderRepo().find({ order: { id: 'DESC' }, take: limit });
  return ok(res, { orders: rows });
}));

/* 管理员主动退款 */
r.post('/admin/orders/:orderNo/refund', adminAuth, handler(async (req, res) => {
  const order = await orderRepo().findOne({ where: { orderNo: req.params.orderNo } });
  if (!order) return ok(res, { ok: false, code: 'NOT_FOUND' });
  const d = await billingService.refund(order.userId, req.params.orderNo, Number(req.body?.cents || order.amountCents), String(req.body?.reason || '管理员发起退款'));
  return ok(res, d);
}));

/* Webhook 重放（手动触发查单补开） */
r.post('/admin/orders/:orderNo/replay', adminAuth, handler(async (req, res) => {
  const order = await billingService.reconcile(req.params.orderNo);
  return ok(res, { order });
}));

/* ---------- 支付渠道 ---------- */
r.get('/admin/payment-channels', adminAuth, handler(async (_req, res) => {
  const rows = await channelRepo().find();
  const channels = rows.map(c => ({ provider: c.provider, enabled: !!c.enabled, config_keys: c.configJson ? Object.keys(c.configJson as object) : [], updated_at: c.updatedAt }));
  return ok(res, { channels });
}));

r.put('/admin/payment-channels/:provider', adminAuth, handler(async (req, res) => {
  const provider = String(req.params.provider);
  if (!PROVIDERS.includes(provider as any)) return ok(res, { ok: false, code: 'INVALID_PROVIDER' });
  const config = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
  // 加密存储敏感配置
  const encrypted = encryptConfig(config);
  const exist = await channelRepo().findOne({ where: { provider } });
  if (exist) {
    exist.enabled = !!req.body?.enabled;
    exist.configJson = { encrypted };
    await channelRepo().save(exist);
  } else {
    await channelRepo().save({ provider, enabled: !!req.body?.enabled, configJson: { encrypted } });
  }
  return ok(res, { provider, enabled: !!req.body?.enabled });
}));

/* 连接测试 */
r.post('/admin/payment-channels/:provider/test', adminAuth, handler(async (req, res) => {
  const provider = String(req.params.provider);
  if (!PROVIDERS.includes(provider as any)) return ok(res, { ok: false, code: 'INVALID_PROVIDER' });
  const raw = req.body?.config || req.body || {};
  const pp = providerFor(provider);
  const missing = pp.validateConfig(raw);
  if (missing.length) {
    const items = missing.map((k: string) => ({ name: k, status: false, message: '缺少必填字段' }));
    return ok(res, { provider, reachable: false, missing, items, message: '配置缺少必填字段' });
  }
  const test = await pp.testConnection(raw);
  return ok(res, { provider, reachable: test.success, missing, items: test.items, message: test.message });
}));

/* 连接测试（用已保存的配置） */
r.post('/admin/payment-channels/:provider/test-saved', adminAuth, handler(async (req, res) => {
  const provider = String(req.params.provider);
  const row = (await channelRepo().findOne({ where: { provider } })) as any;
  if (!row) return ok(res, { provider, reachable: false, items: [], message: '渠道未配置' });
  const raw = decryptConfig(String(row.configJson?.encrypted || '')) as Record<string, string | number | boolean>;
  const pp = providerFor(provider);
  const test = await pp.testConnection(raw);
  return ok(res, { provider, reachable: test.success, items: test.items, message: test.message });
}));

/* ---------- 审计 ---------- */
r.get('/admin/audit-logs', adminAuth, handler(async (req, res) => {
  const logs = await auditService.list(Number(req.query.limit || 100));
  return ok(res, { logs });
}));

/* ---------- 风控 ---------- */
r.get('/admin/risk-rules', adminAuth, handler(async (_req, res) => {
  const rules = await riskService.list();
  return ok(res, { rules });
}));

/* ---------- 系统配置（公告/维护/站点） ---------- */
r.get('/admin/system-configs', adminAuth, handler(async (_req, res) => {
  const list = await systemConfigService.list();
  return ok(res, { configs: list });
}));

r.put('/admin/system-configs/:key', adminAuth, handler(async (req, res) => {
  const d = await systemConfigService.set(req.params.key, req.body?.value || {}, String(req.body?.description || ''));
  return ok(res, d);
}));

/* ---------- 仪表盘统计 ---------- */
r.get('/admin/dashboard', adminAuth, handler(async (_req, res) => {
  const pc = await planRepo().count();
  const orderCount = await orderRepo().count();
  const paidCount = await orderRepo().count({ where: { status: 'paid' as any } });
  const totalRevenue = await orderRepo().createQueryBuilder('o').select('COALESCE(SUM(o.amount_cents),0)', 's').where("o.status='paid'").getRawOne();
  const userCount = await userAdminService.list(1000000);
  return ok(res, {
    stats: {
      plans: pc, orders: orderCount, paidOrders: paidCount,
      revenueCents: Number((totalRevenue as any)?.s || 0),
      users: (userCount as any).length,
    },
  });
}));

export default r;
