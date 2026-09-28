import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Last signature the listener has fully processed; used to backfill after reconnects/restarts. */
@Entity({ name: 'listener_cursor' })
export class ListenerCursor {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ name: 'last_signature', type: 'text', nullable: true })
  lastSignature!: string | null;

  @Column({ name: 'last_slot', type: 'bigint', nullable: true })
  lastSlot!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
