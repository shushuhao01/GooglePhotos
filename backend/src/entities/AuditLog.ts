import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/* 审计日志：谁、何时、对哪个对象做了什么、改前后值 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('increment') id!: number;

  /* 操作者（管理员或用户 ID），nullable 表示匿名/系统 */
  @Column({type: 'varchar', length: 64, nullable: true, name: 'actor_id'}) actorId!: string | null;

  @Column({type: 'varchar', length: 120, nullable: true}) actor!: string | null;

  @Column({ length: 64 }) action!: string;

  @Column({type: 'varchar', length: 64, nullable: true, name: 'target_type'}) targetType!: string | null;
  @Column({type: 'varchar', length: 64, nullable: true, name: 'target_id'}) targetId!: string | null;

  /* 修改前后摘要（JSON 字符串，不含敏感字段） */
  @Column({ type: 'json', nullable: true, name: 'before_value' }) beforeValue!: Record<string, unknown> | null;
  @Column({ type: 'json', nullable: true, name: 'after_value' }) afterValue!: Record<string, unknown> | null;

  @Column({type: 'varchar', length: 64, nullable: true}) ip!: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
