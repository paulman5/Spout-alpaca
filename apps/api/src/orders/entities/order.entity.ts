import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { OrderSide, OrderStatus } from '@spout/shared';

/**
 * Current state of one on-chain order. Business key = (user_pubkey, order_id).
 * History lives in `order_events`; this row is a projection of it.
 */
@Entity({ name: 'orders' })
@Index('idx_orders_claim', ['status', 'nextAttemptAt'])
export class Order {
  @PrimaryColumn({ name: 'user_pubkey', type: 'text' })
  userPubkey!: string;

  /** u64 as decimal string (numeric(20,0) in Postgres). */
  @PrimaryColumn({ name: 'order_id', type: 'numeric', precision: 20, scale: 0 })
  orderId!: string;

  @Column({ type: 'text' })
  side!: OrderSide;

  @Column({ type: 'text' })
  ticker!: string;

  /** USDC (6 dp) for buys, token units for sells, exactly as on-chain. */
  @Column({ type: 'numeric', precision: 20, scale: 0 })
  amount!: string;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @Column({ name: 'client_order_id', type: 'text', unique: true })
  clientOrderId!: string;

  @Column({ name: 'broker_order_id', type: 'text', nullable: true })
  brokerOrderId!: string | null;

  @Column({ name: 'broker_status', type: 'text', nullable: true })
  brokerStatus!: string | null;

  @Column({ name: 'filled_notional', type: 'numeric', precision: 20, scale: 6, nullable: true })
  filledNotional!: string | null;

  @Column({ name: 'filled_qty', type: 'numeric', precision: 24, scale: 9, nullable: true })
  filledQty!: string | null;

  @Column({ name: 'settle_signature', type: 'text', nullable: true })
  settleSignature!: string | null;

  @Column({ name: 'created_signature', type: 'text' })
  createdSignature!: string;

  @Column({ name: 'created_slot', type: 'bigint', nullable: true })
  createdSlot!: string | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: 'locked_by', type: 'text', nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'lock_expires_at', type: 'timestamptz', nullable: true })
  lockExpiresAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
