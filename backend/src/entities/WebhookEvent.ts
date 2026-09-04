import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Index('uq_webhook', { unique: true })
  @Column({ length: 160, name: 'event_id' }) eventId!: string;

  @Column({ length: 32 }) provider!: string;

  @Column({ length: 64, name: 'payload_hash' }) payloadHash!: string;

  @Column({type: 'varchar', length: 64, nullable: true, name: 'order_no'}) orderNo!: string | null;

  @Column({type: 'varchar', length: 64, nullable: true, name: 'process_result'}) processResult!: string | null;

  @CreateDateColumn({ name: 'received_at' }) receivedAt!: Date;
}
