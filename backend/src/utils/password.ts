import { createHash, timingSafeEqual } from 'node:crypto';

/* 密码哈希：SHA-256（与现有 users.password_hash 一致） */
export function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/* 恒定时间比较，防止时序攻击 */
export function safeEqual(a: string, b: string): boolean {
  const am = Buffer.from(a);
  const bm = Buffer.from(b);
  if (am.length !== bm.length) return false;
  return timingSafeEqual(am, bm);
}
