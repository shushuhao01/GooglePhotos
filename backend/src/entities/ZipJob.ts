import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type ZipStatus = 'queued' | 'running' | 'completed' | 'failed' | 'expired' | 'cancelled';

@Entity('zip_jobs')
export class ZipJob {
  @PrimaryGeneratedColumn('increment') id!: number;
  @Index({ unique: true })
  @Column({ length: 64, name: 'job_no' }) jobNo!: string;

  @Index()
  @Column({ name: 'user_id', type: 'bigint' }) userId!: number;

  @Column({ type: 'enum', enum: ['queued', 'running', 'completed', 'failed', 'expired', 'cancelled'], default: 'queued' })
  status!: ZipStatus;

  @Column({ type: 'int', unsigned: true, default: 0, name: 'file_count' }) fileCount!: number;
  @Column({ type: 'bigint', unsigned: true, default: 0, name: 'total_bytes' }) totalBytes!: number;

  @Column({type: 'varchar', length: 500, nullable: true, name: 'download_url'}) downloadUrl!: string | null;
  @Column({type: 'varchar', length: 64, nullable: true, name: 'error_code'}) errorCode!: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'expires_at' }) expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
