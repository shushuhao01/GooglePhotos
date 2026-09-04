import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index } from 'typeorm';

/* 系统配置：公告、维护开关、服务状态页等键值 */
@Entity('system_configs')
export class SystemConfig {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Index({ unique: true })
  @Column({ length: 64, name: 'config_key' }) configKey!: string;

  @Column({ type: 'json', default: () => "'{}'" }) value!: Record<string, unknown>;

  @Column({type: 'varchar', length: 255, nullable: true}) description!: string | null;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
