import 'reflect-metadata';
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { initializeDatabase, closeDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import plansRoutes from './routes/plans.js';
import entitlementsRoutes from './routes/entitlements.js';
import billingRoutes from './routes/billing.js';
import zipRoutes from './routes/zip.js';
import proxyRoutes from './routes/proxy.js';
import adminRoutes from './routes/admin.js';
import { rateLimit } from './middleware/rateLimit.js';
import { systemConfigService } from './services/AdminService.js';
import { fail } from './utils/response.js';

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

/* 打印请求日志 */
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

/* 健康检查 */
app.get('/health', (_req, res) => res.json({ ok: true, service: 'billing-api', time: new Date().toISOString() }));

/* 维护开关（公告/维护） */
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health') return next();
  try {
    const maint = await systemConfigService.get('maintenance');
    /* 兼容旧种子写入的字符串 "false"/"0" 与新写入的布尔 false */
    const raw = (maint as any).enabled;
    const enabled = raw === true || raw === 'true' || raw === '1' || raw === 1;
    if (enabled && !req.path.startsWith('/api/v1/admin')) {
      return fail(res, 503, 'MAINTENANCE', String(maint.message || '系统维护中'));
    }
  } catch { /* 数据库未就绪时放行 */ }
  next();
});

/* API 限流（简化内存版） */
app.use('/api/v1', rateLimit({ windowMs: 60_000, max: 600, keyPrefix: 'api' }));
app.use('/api/v1/auth', rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'auth' }));

app.use('/api/v1', authRoutes);
app.use('/api/v1', plansRoutes);
app.use('/api/v1', entitlementsRoutes);
app.use('/api/v1', billingRoutes);
app.use('/api/v1', zipRoutes);
app.use('/api/v1', proxyRoutes);
app.use('/api/v1', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  try {
    await initializeDatabase();
    logger.info('database connected');
  } catch (e) {
    logger.error('database connection failed, continuing with degraded mode', { error: (e as Error).message });
  }
  const server = app.listen(env.port, () => logger.info(`billing api listening on :${env.port}`));
  const shutdown = async () => {
    server.close();
    await closeDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start();
