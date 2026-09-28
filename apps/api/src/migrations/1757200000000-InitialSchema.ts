import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1757200000000 implements MigrationInterface {
  name = 'InitialSchema1757200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS raw_events (
        signature     text NOT NULL,
        event_index   int  NOT NULL,
        slot          bigint,
        event_name    text NOT NULL,
        user_pubkey   text,
        order_id      numeric(20,0),
        payload       jsonb NOT NULL,
        source        text NOT NULL,
        received_at   timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (signature, event_index)
      );
      CREATE INDEX IF NOT EXISTS idx_raw_events_order ON raw_events (user_pubkey, order_id);

      CREATE TABLE IF NOT EXISTS orders (
        user_pubkey       text NOT NULL,
        order_id          numeric(20,0) NOT NULL,
        side              text NOT NULL,
        ticker            text NOT NULL,
        amount            numeric(20,0) NOT NULL,
        status            text NOT NULL,
        client_order_id   text NOT NULL UNIQUE,
        broker_order_id   text,
        broker_status     text,
        filled_notional   numeric(20,6),
        filled_qty        numeric(24,9),
        settle_signature  text,
        created_signature text NOT NULL,
        created_slot      bigint,
        attempts          int NOT NULL DEFAULT 0,
        next_attempt_at   timestamptz,
        locked_by         text,
        lock_expires_at   timestamptz,
        last_error        text,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_pubkey, order_id),
        CONSTRAINT chk_orders_status CHECK (status IN (
          'recorded','broker_placing','broker_placed','filled','settling','settled','refunding','refunded','needs_human'))
      );
      CREATE INDEX IF NOT EXISTS idx_orders_claim ON orders (status, next_attempt_at);

      CREATE TABLE IF NOT EXISTS order_events (
        id           bigserial PRIMARY KEY,
        user_pubkey  text NOT NULL,
        order_id     numeric(20,0) NOT NULL,
        from_status  text,
        to_status    text NOT NULL,
        reason       text NOT NULL,
        details      jsonb,
        actor        text NOT NULL,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events (user_pubkey, order_id, id);

      CREATE TABLE IF NOT EXISTS alerts (
        id              bigserial PRIMARY KEY,
        user_pubkey     text,
        order_id        numeric(20,0),
        severity        text NOT NULL,
        message         text NOT NULL,
        details         jsonb,
        acknowledged_at timestamptz,
        created_at      timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS listener_cursor (
        id             text PRIMARY KEY,
        last_signature text,
        last_slot      bigint,
        updated_at     timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS listener_cursor, alerts, order_events, orders, raw_events;`);
  }
}
