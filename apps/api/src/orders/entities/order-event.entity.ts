import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** The ledger: every state change (and notable non-change) of an order, in order. */
@Entity({ name: 'order_events' })
@Index('idx_order_events_order', ['userPubkey', 'orderId', 'id'])
export class OrderEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'user_pubkey', type: 'text' })
  userPubkey!: string;

  @Column({ name: 'order_id', type: 'numeric', precision: 20, scale: 0 })
  orderId!: string;

  @Column({ name: 'from_status', type: 'text', nullable: true })
  fromStatus!: string | null;

  @Column({ name: 'to_status', type: 'text' })
  toStatus!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  /** listener | worker:<id> | reconciler | replay | api */
  @Column({ type: 'text' })
  actor!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
