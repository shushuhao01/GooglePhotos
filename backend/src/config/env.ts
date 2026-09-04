import 'dotenv/config';

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function bool(v: string | undefined, d: boolean): boolean {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const env = {
  nodeEnv: String(process.env.NODE_ENV || 'development'),
  port: num(process.env.PORT, 8787),
  appBaseUrl: String(process.env.APP_BASE_URL || 'http://localhost:8787'),
  db: {
    host: String(process.env.DB_HOST || '127.0.0.1'),
    port: num(process.env.DB_PORT, 3306),
    name: String(process.env.DB_NAME || 'web_image_uploader'),
    user: String(process.env.DB_USER || 'root'),
    password: String(process.env.DB_PASSWORD || ''),
  },
  jwtSecret: String(process.env.JWT_SECRET || 'dev-insecure-secret-change-me'),
  jwtExpiresIn: String(process.env.JWT_EXPIRES_IN || '30d'),
  adminEmail: String(process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase(),
  payment: {
    mockEnabled: bool(process.env.PAYMENT_MOCK_ENABLED, true),
    wechatEnabled: bool(process.env.WECHAT_ENABLED, false),
    alipayEnabled: bool(process.env.ALIPAY_ENABLED, false),
    paypalEnabled: bool(process.env.PAYPAL_ENABLED, false),
  },
  proxy: {
    maxBytes: num(process.env.PROXY_MAX_BYTES, 20 * 1024 * 1024),
    timeoutMs: num(process.env.PROXY_TIMEOUT_MS, 15000),
  },
};

export const isProd = () => env.nodeEnv === 'production';
