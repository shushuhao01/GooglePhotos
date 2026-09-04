import { AppDataSource } from '../config/database.js';
import { User } from '../entities/User.js';
import { SystemConfig } from '../entities/SystemConfig.js';
import { signToken } from '../utils/jwt.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/response.js';
import { createHash } from 'node:crypto';

const userRepo = () => AppDataSource.getRepository(User);
const confRepo = () => AppDataSource.getRepository(SystemConfig);

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/* 管理员判定：system_configs 的 admin_emails 列表 ∪ user.is_admin ∪ env.ADMIN_EMAIL 兜底 */
async function checkAdmin(normalized: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  if (normalized === env.adminEmail) return true;
  try {
    const row = await confRepo().findOne({ where: { configKey: 'admin_emails' } });
    const list: string[] = (row?.value as any)?.emails || [];
    return list.some((e) => String(e).trim().toLowerCase() === normalized);
  } catch {
    return false;
  }
}

export class AuthService {
  /* 是否管理员邮箱（供生产环境登录放行判断） */
  async isAdminEmail(email: string): Promise<boolean> {
    const normalized = String(email || '').trim().toLowerCase();
    return checkAdmin(normalized, false);
  }

  /* 开发环境邮箱登录（生产关闭） */
  async devLogin(email: string): Promise<{ token: string; user: { id: number; email: string; admin: boolean } }> {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized || !/^\S+@\S+\.\S+$/.test(normalized)) throw new AppError(400, 'INVALID_EMAIL', '邮箱格式不正确');
    let user = await userRepo().findOne({ where: { email: normalized } });
    if (!user) {
      user = await userRepo().save({ email: normalized, display_name: normalized.split('@')[0], register_ip: '' });
    }
    const admin = await checkAdmin(normalized, !!user.isAdmin);
    const token = signToken({ sub: user.id, email: user.email, admin });
    return { token, user: { id: user.id, email: user.email, admin } };
  }

  /* 邮箱 + 密码注册 */
  async register(email: string, password: string, displayName?: string, ip?: string) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new AppError(400, 'INVALID_EMAIL', '邮箱格式不正确');
    if (!password || password.length < 6) throw new AppError(400, 'WEAK_PASSWORD', '密码至少 6 位');
    const exists = await userRepo().findOne({ where: { email: normalized } });
    if (exists) throw new AppError(409, 'EMAIL_EXISTS', '邮箱已注册');
    const user = await userRepo().save({
      email: normalized, display_name: displayName || normalized.split('@')[0],
      password_hash: sha256(password), register_ip: ip || '',
    });
    const admin = await checkAdmin(normalized, !!user.isAdmin);
    return { token: signToken({ sub: user.id, email: user.email, admin }), user: { id: user.id, email: user.email, admin } };
  }

  /* 邮箱 + 密码登录 */
  async login(email: string, password: string) {
    const normalized = String(email || '').trim().toLowerCase();
    const user = await userRepo().findOne({ where: { email: normalized } });
    if (!user || !user.password_hash) throw new AppError(401, 'BAD_CREDENTIALS', '邮箱或密码错误');
    if (sha256(password) !== user.password_hash) throw new AppError(401, 'BAD_CREDENTIALS', '邮箱或密码错误');
    if (user.status === 'blocked') throw new AppError(403, 'ACCOUNT_BLOCKED', '账号已被封禁');
    const admin = await checkAdmin(normalized, !!user.isAdmin);
    return { token: signToken({ sub: user.id, email: user.email, admin }), user: { id: user.id, email: user.email, admin } };
  }

  async getMe(userId: number) {
    const u = await userRepo().findOne({ where: { id: userId } });
    if (!u) throw new AppError(404, 'USER_NOT_FOUND', '用户不存在');
    return { id: u.id, email: u.email, display_name: u.display_name, status: u.status, isAdmin: u.isAdmin, created_at: u.createdAt };
  }
}

export const authService = new AuthService();
