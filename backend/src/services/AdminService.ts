import { AppDataSource } from '../config/database.js';
import { SystemConfig } from '../entities/SystemConfig.js';
import { RiskRule } from '../entities/RiskRule.js';
import { AuditLog } from '../entities/AuditLog.js';
import { User } from '../entities/User.js';
import { Plan } from '../entities/Plan.js';
import { Subscription } from '../entities/Subscription.js';
import { Order } from '../entities/Order.js';
import { NotFound } from '../utils/response.js';

const confRepo = () => AppDataSource.getRepository(SystemConfig);
const riskRepo = () => AppDataSource.getRepository(RiskRule);
const auditRepo = () => AppDataSource.getRepository(AuditLog);
const userRepo = () => AppDataSource.getRepository(User);
const subRepo = () => AppDataSource.getRepository(Subscription);
const orderRepo = () => AppDataSource.getRepository(Order);

/* ---------- 系统配置 ---------- */
export class SystemConfigService {
  private static DEFAULTS: Record<string, Record<string, unknown>> = {
    announcement: { title: '', content: '', enabled: false },
    maintenance: { enabled: false, message: '系统维护中，请稍后再试' },
    site: { supportEmail: '', website: '' },
  };
  async get(key: string): Promise<Record<string, unknown>> {
    const row = await confRepo().findOne({ where: { configKey: key } });
    return (row?.value as Record<string, unknown>) || SystemConfigService.DEFAULTS[key] || {};
  }
  async set(key: string, value: Record<string, unknown>, description?: string) {
    const exist = await confRepo().findOne({ where: { configKey: key } });
    if (exist) { exist.value = value; if (description) exist.description = description; await confRepo().save(exist); }
    else await confRepo().save({ configKey: key, value, description: description || null });
    return { ok: true };
  }
  async list() { return confRepo().find(); }
  async getAdminEmails(): Promise<string[]> {
    const row = await confRepo().findOne({ where: { configKey: 'admin_emails' } });
    const list = ((row?.value as any)?.emails || []) as string[];
    return list.map((e) => String(e).trim()).filter(Boolean);
  }
  async setAdminEmails(emails: string[]) {
    const clean = Array.isArray(emails) ? emails.map((e) => String(e).trim().toLowerCase()).filter((e) => /^\S+@\S+\.\S+$/.test(e)) : [];
    const exist = await confRepo().findOne({ where: { configKey: 'admin_emails' } });
    if (exist) { exist.value = { emails: clean }; exist.description = '管理员邮箱列表（可视化配置）'; await confRepo().save(exist); }
    else await confRepo().save({ configKey: 'admin_emails', value: { emails: clean }, description: '管理员邮箱列表（可视化配置）' });
    return { emails: clean };
  }
}
export const systemConfigService = new SystemConfigService();

/* ---------- 风控 ---------- */
export class RiskService {
  async list() { return riskRepo().find(); }
  async get(key: string) { return riskRepo().findOne({ where: { key } }); }
  async upsert(key: string, name: string, ruleType: string, value: number, windowSeconds: number, enabled: boolean, action?: string) {
    const exist = await riskRepo().findOne({ where: { key } });
    if (exist) { exist.name = name; exist.ruleType = ruleType; exist.value = value; exist.windowSeconds = windowSeconds; exist.enabled = enabled; exist.action = action || null; await riskRepo().save(exist); }
    else await riskRepo().save({ key, name, ruleType, value, windowSeconds, enabled, action: action || null });
    return { ok: true };
  }
}
export const riskService = new RiskService();

/* ---------- 审计 ---------- */
export class AuditService {
  async list(limit = 100) { return auditRepo().find({ order: { id: 'DESC' }, take: Math.min(500, limit) }); }
}
export const auditService = new AuditService();

/* ---------- 用户管理 ---------- */
export class UserAdminService {
  async list(limit = 50) {
    return userRepo().find({ order: { id: 'DESC' }, take: Math.min(200, limit), select: ['id', 'email', 'display_name', 'status', 'isAdmin', 'createdAt'] as any });
  }
  async setStatus(userId: number, status: 'active' | 'blocked' | 'deleted') {
    await userRepo().update({ id: userId }, { status });
    return { ok: true };
  }
  async setAdmin(userId: number, isAdmin: boolean) {
    await userRepo().update({ id: userId }, { isAdmin: !!isAdmin });
    return { ok: true };
  }
  async adjustQuota(userId: number, planCode: string) {
    const plan = await AppDataSource.getRepository(Plan).findOne({ where: { code: planCode } });
    if (!plan) throw NotFound('套餐不存在');
    await subRepo().insert({ userId, planId: plan.id, source: 'gift', status: 'active', startAt: new Date(), expiresAt: plan.billingPeriod === 'month' ? new Date(Date.now() + 30 * 24 * 3600 * 1000) : plan.billingPeriod === 'year' ? new Date(Date.now() + 365 * 24 * 3600 * 1000) : null });
    return { ok: true };
  }
  async detail(userId: number) {
    const user = await userRepo().findOne({ where: { id: userId }, select: ['id', 'email', 'display_name', 'status', 'createdAt'] as any });
    const subs = await subRepo().find({ where: { userId } });
    const orders = await orderRepo().find({ where: { userId }, order: { id: 'DESC' }, take: 20 });
    return { user, subscriptions: subs, orders };
  }
}
export const userAdminService = new UserAdminService();
