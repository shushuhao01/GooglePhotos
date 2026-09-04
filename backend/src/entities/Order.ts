import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'expired' | 'partially_refunded';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('increment') id!: number;
  @Index({ unique: true })
  @Column({ length: 64, name: 'order_no' }) orderNo!: string;

  @Index()
  @Column({ name: 'user_id', type: 'bigint' }) userId!: number;

  @Index()
  @Column({ name: 'plan_id', type: 'bigint' }) planId!: number;

  @Column({ length: 32 }) provider!: string;

  @Column({ type: 'enum', enum: ['pending', 'paid', 'failed', 'refunded', 'expired', 'partially_refunded'], default: 'pending' })
  status!: OrderStatus;

  @Column({ type: 'int', unsigned: true, name: 'amount_cents' }) amountCents!: number;

  /* 退款金额累积（分） */
  @Column({ type: 'int', unsigned: true, default: 0, name: 'refunded_cents' }) refundedCents!: number;

  @Column({type: 'varchar', length: 128, nullable: true, name: 'provider_trade_no'}) providerTradeNo!: string | null;

  /* 幂等键（防止扩展端重复下单） */
  @Column({type: 'varchar', length: 64, nullable: true, name: 'idempotency_key'}) idempotencyKey!: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'paid_at' }) paidAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
