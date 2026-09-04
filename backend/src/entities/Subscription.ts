import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'pending';

/* 用户订阅（套餐叠加购买或订阅付费） */
@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Index()
  @Column({ name: 'user_id', type: 'bigint' }) userId!: number;

  @Index()
  @Column({ name: 'plan_id', type: 'bigint' }) planId!: number;

  @Column({type: 'varchar', length: 64, nullable: true, name: 'order_no'}) orderNo!: string | null;

  /* 来源：purchase / upgrade / gift */
  @Column({ length: 32, default: 'purchase' }) source!: string;

  /* plan_id 是否覆盖当前周期；不同套餐可并存多个订阅，取最高级 */
  @Column({ type: 'enum', enum: ['active', 'expired', 'cancelled', 'pending'], default: 'pending' })
  status!: SubscriptionStatus;

  /* 生效时间：subscription 周期起始（月/年/永久） */
  @Column({ type: 'timestamp', nullable: true, name: 'start_at' }) startAt!: Date | null;
  @Column({ type: 'timestamp', nullable: true, name: 'expires_at' }) expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
