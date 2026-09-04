import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/* 用 JWT_SECRET 派生 AES-256-GCM 密钥加密支付渠道敏感配置 */
function key(): Buffer {
  return createHash('sha256').update(env.jwtSecret).digest();
}

export function encryptConfig(cfg: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = JSON.stringify(cfg);
  const enc = Buffer.concat([c.update(body, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `v1.${iv.toString('hex')}.${tag.toString('hex')}.${enc.toString('hex')}`;
}

export function decryptConfig(token: string): Record<string, unknown> {
  const [v, ivHex, tagHex, dataHex] = token.split('.');
  if (v !== 'v1') return {};
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
    d.setAuthTag(Buffer.from(tagHex, 'hex'));
    const body = Buffer.concat([d.update(Buffer.from(dataHex, 'hex')), d.final()]);
    return JSON.parse(body.toString('utf8'));
  } catch {
    return {};
  }
}

/* 是否已加密（lenient 判断） */
export function isEncrypted(token: string): boolean {
  return token.startsWith('v1.') && token.split('.').length === 4;
}
