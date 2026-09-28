import { MigrationInterface, QueryRunner } from 'typeorm';

/** Keep the raw program logs with each captured event, so replays never depend on the RPC. */
export class RawEventLogs1757200002000 implements MigrationInterface {
  name = 'RawEventLogs1757200002000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS logs text[]`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE raw_events DROP COLUMN IF EXISTS logs`);
  }
}
