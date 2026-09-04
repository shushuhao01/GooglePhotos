import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/* 风控规则：IP/账号/设备限流、异常任务、批量注册 */
@Entity('risk_rules')
export class RiskRule {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Index({ unique: true })
  @Column({ length: 64 }) key!: string;

  @Column({ length: 120 }) name!: string;

  /* 规则类型：rate_limit / batch_register / task_rate / ip_block */
  @Column({ length: 64, name: 'rule_type' }) ruleType!: string;

  /* 阈值：如每分钟最大请求数 = value */
  @Column({ type: 'int', default: 0 }) value!: number;

  /* 窗口秒数 */
  @Column({ type: 'int', default: 60, name: 'window_seconds' }) windowSeconds!: number;

  @Column({ type: 'tinyint', default: 0 }) enabled!: boolean;

  @Column({type: 'varchar', length: 255, nullable: true}) action!: string | null; /* block / warn / challenge */

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
