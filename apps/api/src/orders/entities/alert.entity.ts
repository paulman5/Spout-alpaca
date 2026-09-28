import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Things a human must look at (dead-letters, drift the reconciler could not repair). */
@Entity({ name: 'alerts' })
export class Alert {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'user_pubkey', type: 'text', nullable: true })
  userPubkey!: string | null;

  @Column({ name: 'order_id', type: 'numeric', precision: 20, scale: 0, nullable: true })
  orderId!: string | null;

  @Column({ type: 'text' })
  severity!: 'warning' | 'critical';

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
