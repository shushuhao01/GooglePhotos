import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { AppDataSource } from '../config/database.js';
import { Order } from '../entities/Order.js';
import { Plan } from '../entities/Plan.js';
import { PaymentChannel } from '../entities/PaymentChannel.js';
import { WebhookEvent } from '../entities/WebhookEvent.js';
import { Subscription } from '../entities/Subscription.js';
import { User } from '../entities/User.js';
import { providerFor } from '../payments/index.js';
import { env } from '../config/env.js';
import { AppError, NotFound } from '../utils/response.js';
import { decryptConfig, isEncrypted } from '../utils/cryptoConfig.js';
import { entitlementService } from './EntitlementService.js';
import { logger } from '../config/logger.js';

const orderRepo = () => AppDataSource.getRepository(Order);
const planRepo = () => AppDataSource.getRepository(Plan);
const channelRepo = () => AppDataSource.getRepository(PaymentChannel);
const webhookRepo = () => AppDataSource.getRepository(WebhookEvent);
const subRepo = () => AppDataSource.getRepository(Subscription);
const userRepo = () => AppDataSource.getRepository(User);

function genOrderNo(): string {
  return 'PGX' + Date.now().toString(36).toUpperCase() + randomBytes(4).toString('hex');
}

async function loadChannelConfig(provider: string): Promise<Record<string, any>> {
  const ch = await channelRepo().findOne({ where: { provider } });
  if (!ch) return {};
  const raw = ch.configJson as any;
  if (raw && raw.encrypted && isEncrypted(String(raw.encrypted))) {
    return decryptConfig(String(raw.encrypted));
  }
  return (raw || {});
}

export class BillingService {
  async createCheckout(userId: number, planCode: string, provider: string, idempotencyKey?: string) {
    const plan = await planRepo().findOne({ where: { code: planCode } });
    if (!plan || !plan.isActive) throw NotFound('套餐不存在或已下架');
    if (!['mock', 'wechat', 'alipay', 'paypal'].includes(provider)) throw new AppError(400, 'INVALID_PROVIDER', '不支持的支付渠道');
    const cfg = await loadChannelConfig(provider);
    const paymentProvider = providerFor(provider);
    const missing = paymentProvider.validateConfig(cfg);
    if (missing.length && provider !== 'mock') {
      throw new AppError(400, 'PAYMENT_CONFIG_INCOMPLETE', '支付渠道配置不完整', { missing });
    }
    // 幂等：同一用户+同一幂等键复用已有 pending 订单
    if (idempotencyKey) {
      const exist = await orderRepo().findOne({ where: { userId, idempotencyKey } });
      if (exist && exist.status === 'pending') {
        return { orderNo: exist.orderNo, amountCents: exist.amountCents, provider, idem: true };
      }
    }
    const orderNo = genOrderNo();
    const notifyUrl = `${env.appBaseUrl}/api/v1/billing/webhooks/${provider}`;
    const order = await orderRepo().save({ orderNo, userId, planId: plan.id, provider, status: 'pending', amountCents: plan.priceCents, idempotencyKey: idempotencyKey || null });
    let checkout: any;
    if (provider === 'mock') {
      paymentProvider.validateConfig(cfg);
      checkout = await paymentProvider.createCheckout({ orderNo, amountCents: plan.priceCents, title: plan.name, notifyUrl }, cfg);
    } else {
      checkout = await paymentProvider.createCheckout({ orderNo, amountCents: plan.priceCents, title: plan.name, notifyUrl }, cfg);
    }
    return { orderNo: order.orderNo, amountCents: order.amountCents, provider, checkout };
  }

  async mockPay(userId: number, orderNo: string) {
    const r = await orderRepo().update({ orderNo, userId, status: 'pending' }, { status: 'paid', paidAt: new Date(), providerTradeNo: 'mock_' + orderNo });
    if (!r.affected) throw new AppError(409, 'ORDER_NOT_PENDING', '订单不是待支付状态');
    const order = await orderRepo().findOne({ where: { orderNo, userId } });
    await this.grantPlanByOrder(order!);
    return { ok: true, status: 'paid' };
  }

  async handleWebhook(provider: string, headers: Record<string, string | undefined>, rawBody: string): Promise<{ ok: boolean; duplicate?: boolean; accepted?: boolean }> {
    const paymentProvider = providerFor(provider);
    const cfg = await loadChannelConfig(provider);
    let parsed: { eventId: string; orderNo: string; paid: boolean; amountCents?: number; providerTradeNo?: string | null };
    try {
      parsed = await paymentProvider.verifyWebhook(headers, rawBody, cfg);
    } catch (e: any) {
      throw new AppError(400, 'WEBHOOK_VERIFY_FAIL', '回调验签失败：' + e.message);
    }
    // 幂等：同一 eventId 只处理一次
    const hash = createHash('sha256').update(rawBody).digest('hex');
    const ins = await webhookRepo().insert({ provider, eventId: parsed.eventId, payloadHash: hash, orderNo: parsed.orderNo, processResult: 'accepted' }).catch((e: any) => {
      // dup key 说明已处理
      if (String(e?.code || '').includes('ER_DUP_ENTRY')) return null;
      throw e;
    });
    if (ins === null) return { ok: true, duplicate: true };
    if (!parsed.paid) return { ok: true, accepted: true };

    const order = await orderRepo().findOne({ where: { orderNo: parsed.orderNo } });
    if (!order) return { ok: true, accepted: true, duplicate: false };
    if (order.status === 'paid') return { ok: true, duplicate: true };
    // 金额核对
    if (parsed.amountCents && parsed.amountCents !== order.amountCents) {
      logger.error('webhook amount mismatch', { orderNo: parsed.orderNo, got: parsed.amountCents, expected: order.amountCents });
      return { ok: true, accepted: true, duplicate: false };
    }
    await orderRepo().update({ id: order.id, status: 'pending' }, { status: 'paid', paidAt: new Date(), providerTradeNo: parsed.providerTradeNo || order.providerTradeNo, idempotencyKey: order.idempotencyKey });
    await this.grantPlanByOrder({ ...order, status: 'paid', providerTradeNo: parsed.providerTradeNo || null });
    return { ok: true, accepted: true };
  }

  /* 订单支付成功后开通套餐订阅 */
  async grantPlanByOrder(order: Order) {
    const plan = await planRepo().findOne({ where: { id: order.planId } });
    if (!plan) return;
    const now = new Date();
    let expiresAt: Date | null = null;
    if (plan.billingPeriod === 'month') { expiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000); }
    else if (plan.billingPeriod === 'year') { expiresAt = new Date(now.getTime() + 365 * 24 * 3600 * 1000); }
    else if (plan.billingPeriod === 'one_time') { expiresAt = new Date(now.getTime() + 365 * 24 * 3600 * 1000); }
    // lifetime 不设过期
    await subRepo().insert({ userId: order.userId, planId: plan.id, orderNo: order.orderNo, source: 'purchase', status: 'active', startAt: now, expiresAt });
    // 把套餐额度叠加到当前周期剩余
    await entitlementService.grantQuota(order.userId, plan.id);
  }

  async orders(userId: number) {
    return orderRepo().find({ where: { userId }, order: { id: 'DESC' }, take: 100 });
  }

  async orderDetail(userId: number, orderNo: string) {
    return orderRepo().findOne({ where: { orderNo, userId } });
  }

  /* 主动查单：支付平台查单，若已支付则补开订阅 */
  async reconcile(orderNo: string) {
    const order = await orderRepo().findOne({ where: { orderNo } });
    if (!order) throw NotFound('订单不存在');
    if (order.status === 'paid') return order;
    const cfg = await loadChannelConfig(order.provider);
    const pp = providerFor(order.provider);
    const result = await pp.queryOrder(orderNo, cfg);
    if (result.paid) {
      await orderRepo().update({ id: order.id, status: 'pending' }, { status: 'paid', paidAt: new Date(), providerTradeNo: result.providerTradeNo || order.providerTradeNo });
      await this.grantPlanByOrder({ ...order, status: 'paid', providerTradeNo: result.providerTradeNo || null });
    }
    return orderRepo().findOne({ where: { orderNo } });
  }

  async refund(userId: number, orderNo: string, cents: number, reason?: string) {
    const order = await orderRepo().findOne({ where: { orderNo, userId } });
    if (!order) throw NotFound('订单不存在');
    if (order.status !== 'paid') throw new AppError(409, 'ORDER_NOT_PAID', '仅已支付订单可退款');
    if (cents <= 0 || cents > order.amountCents - order.refundedCents) throw new AppError(400, 'INVALID_REFUND_AMOUNT', '退款金额不合法');
    await orderRepo().update({ id: order.id }, { refundedCents: order.refundedCents + cents, status: order.refundedCents + cents >= order.amountCents ? 'refunded' : 'partially_refunded' });
    // 退还对应额度
    const sub = await subRepo().findOne({ where: { orderNo } });
    if (sub) {
      await subRepo().update({ id: sub.id }, { status: 'cancelled' });
      await entitlementService.revokeQuota(userId, sub.planId);
    }
    return { ok: true, refunded: cents, status: 'refunded' };
  }
}

export const billingService = new BillingService();

/* 删除账号关联数据 */
export async function deleteAccountData(userId: number) {
  const conn = AppDataSource;
  await conn.transaction(async (em: any) => {
    await em.query('DELETE FROM subscriptions WHERE user_id = ?', [userId]);
    await em.query('DELETE FROM entitlements WHERE user_id = ?', [userId]);
    await em.query('DELETE FROM orders WHERE user_id = ?', [userId]);
    await em.query('DELETE FROM zip_jobs WHERE user_id = ?', [userId]);
  });
  await userRepo().delete({ id: userId });
  return { ok: true };
}
