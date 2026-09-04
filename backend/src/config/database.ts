import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from './env.js';
import { User } from '../entities/User.js';
import { Plan } from '../entities/Plan.js';
import { Entitlement } from '../entities/Entitlement.js';
import { Order } from '../entities/Order.js';
import { PaymentChannel } from '../entities/PaymentChannel.js';
import { WebhookEvent } from '../entities/WebhookEvent.js';
import { ZipJob } from '../entities/ZipJob.js';
import { Subscription } from '../entities/Subscription.js';
import { AuditLog } from '../entities/AuditLog.js';
import { SystemConfig } from '../entities/SystemConfig.js';
import { RiskRule } from '../entities/RiskRule.js';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  username: env.db.user,
  password: env.db.password,
  synchronize: false,
  logging: false,
  entities: [
    User, Plan, Entitlement, Order, PaymentChannel, WebhookEvent,
    ZipJob, Subscription, AuditLog, SystemConfig, RiskRule,
  ],
  migrations: [],
});

export async function initializeDatabase(): Promise<DataSource> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
}

export async function closeDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}
