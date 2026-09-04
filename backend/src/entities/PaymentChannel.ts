import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index } from 'typeorm';

@Entity('payment_channels')
export class PaymentChannel {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Index({ unique: true })
  @Column({ length: 32 }) provider!: string;

  @Column({ type: 'tinyint', default: 0 }) enabled!: boolean;

  /* 敏感信息加密存储；明文只在管理后台回显 */
  @Column({ type: 'json', name: 'config_json', default: () => "'{}'" }) configJson!: Record<string, unknown>;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
