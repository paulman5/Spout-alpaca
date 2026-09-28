import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/** Append-only capture of program events, exactly as decoded. One row per (signature, event index). */
@Entity({ name: 'raw_events' })
@Index('idx_raw_events_order', ['userPubkey', 'orderId'])
export class RawEvent {
  @PrimaryColumn({ type: 'text' })
  signature!: string;

  @PrimaryColumn({ name: 'event_index', type: 'int' })
  eventIndex!: number;

  @Column({ type: 'bigint', nullable: true })
  slot!: string | null;

  @Column({ name: 'event_name', type: 'text' })
  eventName!: string;

  @Column({ name: 'user_pubkey', type: 'text', nullable: true })
  userPubkey!: string | null;

  @Column({ name: 'order_id', type: 'numeric', precision: 20, scale: 0, nullable: true })
  orderId!: string | null;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  /** The program log lines exactly as received; replays are decoded from these, not from the RPC. */
  @Column({ type: 'text', array: true, nullable: true })
  logs!: string[] | null;

  /** ws | backfill | replay */
  @Column({ type: 'text' })
  source!: string;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
