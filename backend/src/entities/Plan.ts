import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type BillingPeriod = 'month' | 'year' | 'lifetime' | 'one_time';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Index({ unique: true })
  @Column({ length: 64 }) code!: string;

  @Column({ length: 120 }) name!: string;

  @Column({ length: 3, default: 'CNY' }) currency!: string;

  @Column({ type: 'int', unsigned: true, default: 0, name: 'price_cents' }) priceCents!: number;

  @Column({ type: 'enum', enum: ['month', 'year', 'lifetime', 'one_time'], default: 'month', name: 'billing_period' })
  billingPeriod!: BillingPeriod;

  @Column({ type: 'int', unsigned: true, default: 1, name: 'upload_quota' }) uploadQuota!: number;
  @Column({ type: 'int', unsigned: true, default: 1, name: 'download_quota' }) downloadQuota!: number;
  @Column({ type: 'int', unsigned: true, default: 1, name: 'zip_quota' }) zipQuota!: number;

  @Column({ type: 'int', unsigned: true, default: 10, name: 'max_items' }) maxItems!: number;
  @Column({ type: 'bigint', unsigned: true, default: 209715200, name: 'max_bytes' }) maxBytes!: number;

  /* Zip 上限与是否允许服务端中转/并发 */
  @Column({ type: 'int', unsigned: true, default: 1, name: 'concurrency' }) concurrency!: number;

  /* 试用期（天），0 无试用 */
  @Column({ type: 'int', unsigned: true, default: 0, name: 'trial_days' }) trialDays!: number;

  /* 退款策略描述 */
  @Column({type: 'varchar', length: 255, nullable: true, name: 'refund_policy'}) refundPolicy!: string | null;

  @Column({ type: 'tinyint', default: 1, name: 'is_active' }) isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
