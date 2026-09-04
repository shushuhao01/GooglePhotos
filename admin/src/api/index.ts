import { ElMessage } from 'element-plus';

/* 后台服务地址解析优先级：
 * 1. localStorage 用户手动设置（pgx_api_base）
 * 2. 构建时环境变量 VITE_API_BASE
 * 3. 自动推导：当前访问后台的域名（同域反向代理最常见）
 * 4. 兜底 localhost:8787（本地开发）
 */
function resolveApiBase(): string {
  const stored = localStorage.getItem('pgx_api_base');
  if (stored) return stored.replace(/\/$/, '');
  const envBase = (import.meta as any).env?.VITE_API_BASE;
  if (envBase) return String(envBase).replace(/\/$/, '');
  try {
    const { protocol, hostname, port } = window.location;
    // 后台与 API 同域反代：如 https://admin.example.com/api/v1
    return `${protocol}//${hostname}${port ? ':' + port : ''}`;
  } catch {
    return 'http://localhost:8787';
  }
}

const API = resolveApiBase() + '/api/v1';

export function getApiBase(): string {
  return API.replace('/api/v1', '');
}

export function setApiBase(base: string) {
  localStorage.setItem('pgx_api_base', base);
}

export function getToken(): string {
  return localStorage.getItem('pgx_admin_token') || '';
}

export function setToken(t: string) {
  localStorage.setItem('pgx_admin_token', t);
}

export function clearToken() {
  localStorage.removeItem('pgx_admin_token');
}

export async function req<T = any>(path: string, opt: RequestInit = {}): Promise<T> {
  const headers = new Headers(opt.headers);
  if (getToken()) headers.set('Authorization', 'Bearer ' + getToken());
  const r = await fetch(API + path, { ...opt, headers });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) {
    throw Error(d.message || d.code || `HTTP ${r.status}`);
  }
  return d as T;
}

export function err(e: any) {
  ElMessage.error(e?.message || '请求失败');
}
