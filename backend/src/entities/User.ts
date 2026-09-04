import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type UserStatus = 'active' | 'blocked' | 'deleted';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Index({ unique: true })
  @Column({ length: 255 }) email!: string;

  @Column({type: 'varchar', length: 120, nullable: true}) display_name!: string | null;

  @Column({ type: 'enum', enum: ['active', 'blocked', 'deleted'], default: 'active' })
  status!: UserStatus;

  /* 产品账号密码（邮箱+密码登录用），可空表示仅第三方登录 */
  @Column({type: 'varchar', length: 255, nullable: true, select: false}) password_hash!: string | null;

  /* Google 登录外部标识 */
  @Column({type: 'varchar', length: 255, nullable: true}) google_sub!: string | null;

  /* 是否后台管理员 */
  @Column({ type: 'tinyint', default: 0, name: 'is_admin' }) isAdmin!: boolean;

  /* 风控：注册来源 IP 简写，用于批量注册检测 */
  @Column({type: 'varchar', length: 64, nullable: true}) register_ip!: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
