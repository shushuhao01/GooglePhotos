import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index } from 'typeorm';

@Entity('entitlements')
export class Entitlement {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Index('uq_entitlement', { unique: true })
  @Column({ name: 'user_id', type: 'bigint' }) userId!: number;

  @Column({ length: 32, name: 'period_key' }) periodKey!: string;

  @Column({ type: 'int', default: 0, name: 'upload_remaining' }) uploadRemaining!: number;
  @Column({ type: 'int', default: 0, name: 'download_remaining' }) downloadRemaining!: number;
  @Column({ type: 'int', default: 0, name: 'zip_remaining' }) zipRemaining!: number;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
