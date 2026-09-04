import { AppDataSource } from '../config/database.js';
import { User } from '../entities/User.js';
import { SystemConfig } from '../entities/SystemConfig.js';
import { signToken } from '../utils/jwt.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/response.js';
import { sha256, safeEqual } from '../utils/password.js';

const userRepo = () => AppDataSource.getRepository(User);
const confRepo = () => AppDataSource.getRepository(SystemConfig);

/* ============================================================
 * 管理员账号密码登录（admin/admin123，可在系统设置中修改）
 * 存储于 system_configs.admin_credential = { username, password_hash }
 * ============================================================ */
const ADMIN_CRED_KEY = 'admin_credential';

/* 默认凭据（首次使用/未配置时生效） */
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

function normalizeUsername(u: string): string {
  return String(u || '').trim().toLowerCase().replace(/\s+/g, '');
}

/* 读取管理员凭据，不存在则落库默认值 */
export async function getAdminCredential(): Promise<{ username: string; password_hash: string }> {
  const row = await confRepo().findOne({ where: { configKey: ADMIN_CRED_KEY } });
  if (row && row.value && (row.value as any).username) {
    const v = row.value as any;
    return { username: String(v.username), password_hash: String(v.password_hash || '') };
  }
  // 落库默认
  const cred = { username: DEFAULT_ADMIN_USERNAME, password_hash: sha256(DEFAULT_ADMIN_PASSWORD) };
  await confRepo().save({ configKey: ADMIN_CRED_KEY, value: cred as unknown as Record<string, unknown>, description: '后台管理员账号（默认 admin/admin123，请及时修改）' });
  return cred;
}

/* 修改管理员凭据 */
export async function setAdminCredential(username: string, password?: string): Promise<{ ok: true }> {
  const un = normalizeUsername(username);
  if (!un) throw new AppError(400, 'INVALID_USERNAME', '管理员账号不能为空');
  const current = await getAdminCredential();
  const value: Record<string, unknown> = { username: un, password_hash: current.password_hash };
  if (password) {
    if (password.length < 6) throw new AppError(400, 'WEAK_PASSWORD', '密码至少 6 位');
    value.password_hash = sha256(password);
  }
  const exist = await confRepo().findOne({ where: { configKey: ADMIN_CRED_KEY } });
  if (exist) { exist.value = value; await confRepo().save(exist); }
  else await confRepo().save({ configKey: ADMIN_CRED_KEY, value, description: '后台管理员账号' });
  return { ok: true };
}

/* 校验管理员账号+密码，返回是否匹配 */
export async function verifyAdminCredential(username: string, password: string): Promise<boolean> {
  if (!username || !password) return false;
  const cred = await getAdminCredential();
  if (normalizeUsername(username) !== normalizeUsername(cred.username)) return false;
  return safeEqual(sha256(password), cred.password_hash);
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

  /* 管理员后台账号+密码登录（admin/admin123），返回管理员 JWT（独立于产品账号） */
  async adminLogin(username: string, password: string): Promise<{ token: string; user: { sub: number; email: string; admin: boolean; username: string } }> {
    const ok = await verifyAdminCredential(username, password);
    if (!ok) throw new AppError(401, 'BAD_CREDENTIALS', '管理员账号或密码错误');
    // 绑定一个虚拟管理员身份：sub=0 表示后台管理员，不走产品账号体系
    const token = signToken({ sub: 0, email: '@admin', admin: true });
    return { token, user: { sub: 0, email: '@admin', admin: true, username: normalizeUsername(username) } };
  }

  async getMe(userId: number) {
    const u = await userRepo().findOne({ where: { id: userId } });
    if (!u) throw new AppError(404, 'USER_NOT_FOUND', '用户不存在');
    return { id: u.id, email: u.email, display_name: u.display_name, status: u.status, isAdmin: u.isAdmin, created_at: u.createdAt };
  }
}

export const authService = new AuthService();
