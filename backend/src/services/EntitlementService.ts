import { AppDataSource } from '../config/database.js';
import { Entitlement } from '../entities/Entitlement.js';
import { Plan } from '../entities/Plan.js';
import { Subscription } from '../entities/Subscription.js';
import { User } from '../entities/User.js';
import { AppError } from '../utils/response.js';

export type Operation = 'upload' | 'download' | 'zip';

const entRepo = () => AppDataSource.getRepository(Entitlement);
const planRepo = () => AppDataSource.getRepository(Plan);
const subRepo = () => AppDataSource.getRepository(Subscription);
const userRepo = () => AppDataSource.getRepository(User);

function periodKey(now = new Date()): string { return now.toISOString().slice(0, 7); }
const OPS: Operation[] = ['upload', 'download', 'zip'];
const COL: Record<Operation, string> = { upload: 'uploadRemaining', download: 'downloadRemaining', zip: 'zipRemaining' };
const SQL_COL: Record<Operation, string> = { upload: 'upload_remaining', download: 'download_remaining', zip: 'zip_remaining' };

function quotaForPlan(plan: Plan, op: Operation): number {
  if (op === 'upload') return plan.uploadQuota;
  if (op === 'download') return plan.downloadQuota;
  return plan.zipQuota;
}

export class EntitlementService {
  /* 计算某用户当前周期可用的总额度（免费基础 + 有效订阅套餐） */
  private async totalQuota(userId: number, period: string): Promise<Record<Operation, number>> {
    const acc: Record<Operation, number> = { upload: 1, download: 1, zip: 1 }; // 免费基础：每月各 1 次
    const subs = await subRepo().find({ where: { userId, status: 'active' } });
    if (subs.length) {
      const ids = subs.map(s => s.planId);
      const plans = await planRepo().createQueryBuilder('p').where('p.id IN (:...ids)', { ids }).getMany();
      for (const p of plans) if (p.isActive) for (const op of OPS) acc[op] += quotaForPlan(p, op);
    }
    return acc;
  }

  async status(userId: number) {
    const period = periodKey();
    const total = await this.totalQuota(userId, period);
    const ent = await entRepo().findOne({ where: { userId, periodKey: period } });
    // 已用量 = 总额度 - 剩余（ent 不存在视为尚未消耗）
    const used: Record<Operation, number> = { upload: 0, download: 0, zip: 0 };
    if (ent) {
      for (const op of OPS) {
        const rem = Number(ent[COL[op] as 'uploadRemaining' | 'downloadRemaining' | 'zipRemaining'] ?? 0);
        used[op] = Math.max(0, total[op] - rem);
      }
    }
    const remaining: Record<Operation, number> = { upload: 0, download: 0, zip: 0 };
    for (const op of OPS) remaining[op] = Math.max(0, total[op] - used[op]);
    return {
      period_key: period,
      upload_remaining: remaining.upload,
      download_remaining: remaining.download,
      zip_remaining: remaining.zip,
      plan_quota: total,
      used,
      free: total,
    };
  }

  async reserve(userId: number, operation: Operation, reqId: string) {
    if (!OPS.includes(operation)) throw new AppError(400, 'INVALID_OPERATION', '非法操作类型');
    const period = periodKey();
    const col = SQL_COL[operation];
    const conn = AppDataSource;
    await conn.transaction(async (em) => {
      // 1) 确保有 entitlement 行，初始化为总额度
      let ent = await em.getRepository(Entitlement).findOne({ where: { userId, periodKey: period } });
      const total = await this.totalQuota(userId, period);
      if (!ent) {
        ent = await em.getRepository(Entitlement).save({ userId, periodKey: period, uploadRemaining: total.upload, downloadRemaining: total.download, zipRemaining: total.zip });
      }
      // 2) 复核剩余额度
      const rem = Number(ent[COL[operation] as 'uploadRemaining' | 'downloadRemaining' | 'zipRemaining'] ?? 0);
      if (rem <= 0) throw new AppError(402, 'QUOTA_EXCEEDED', '额度不足，请升级套餐');
      // 3) 扣减
      const r = await em.query(`UPDATE entitlements SET ${col} = ${col} - 1 WHERE user_id = ? AND period_key = ? AND ${col} > 0`, [userId, period]);
      if (!(r as any).affectedRows) throw new AppError(402, 'QUOTA_EXCEEDED', '额度不足，请升级套餐');
    });
    return { reservation: reqId, operation, period };
  }

  async commit(userId: number, operation: Operation, reservation: string) {
    // 预扣已在 reserve 中完成，commit 仅确认，此处幂等返回
    return { ok: true, reservation, operation };
  }

  /* 授予套餐：把套餐额度叠加到当前周期剩余（并补建 entitlement 行） */
  async grantQuota(userId: number, planId: number) {
    const period = periodKey();
    const plan = await planRepo().findOne({ where: { id: planId } });
    if (!plan || !plan.isActive) return { ok: true, added: 0 };
    const conn = AppDataSource;
    await conn.transaction(async (em) => {
      let ent = await em.getRepository(Entitlement).findOne({ where: { userId, periodKey: period } });
      if (!ent) {
        ent = await em.getRepository(Entitlement).save({
          userId, periodKey: period,
          uploadRemaining: 1, downloadRemaining: 1, zipRemaining: 1,
        });
      }
      await em.query(
        'UPDATE entitlements SET upload_remaining = upload_remaining + ?, download_remaining = download_remaining + ?, zip_remaining = zip_remaining + ? WHERE user_id = ? AND period_key = ?',
        [plan.uploadQuota, plan.downloadQuota, plan.zipQuota, userId, period]
      );
    });
    return { ok: true, added: { upload: plan.uploadQuota, download: plan.downloadQuota, zip: plan.zipQuota } };
  }

  /* 取消/退款套餐：从当前周期剩余中扣回对应额度（不低于 0） */
  async revokeQuota(userId: number, planId: number) {
    const period = periodKey();
    const plan = await planRepo().findOne({ where: { id: planId } });
    if (!plan) return { ok: true, removed: 0 };
    await AppDataSource.query(
      'UPDATE entitlements SET upload_remaining = GREATEST(upload_remaining - ?, 0), download_remaining = GREATEST(download_remaining - ?, 0), zip_remaining = GREATEST(zip_remaining - ?, 0) WHERE user_id = ? AND period_key = ?',
      [plan.uploadQuota, plan.downloadQuota, plan.zipQuota, userId, period]
    );
    return { ok: true, removed: { upload: plan.uploadQuota, download: plan.downloadQuota, zip: plan.zipQuota } };
  }

  async release(userId: number, operation: Operation, reservation: string) {
    const period = periodKey();
    const col = SQL_COL[operation];
    await AppDataSource.query(`UPDATE entitlements SET ${col} = ${col} + 1 WHERE user_id = ? AND period_key = ?`, [userId, period]);
    return { ok: true, reservation, operation };
  }
}

export const entitlementService = new EntitlementService();
