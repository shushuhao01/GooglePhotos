import { ElMessage } from 'element-plus';

const API = (localStorage.getItem('pgx_api_base') || 'http://localhost:8787').replace(/\/$/, '') + '/api/v1';

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
