import { MigrationInterface, QueryRunner } from 'typeorm';

/** Operational switches shared by all processes (e.g. the worker kill-switch). */
export class PipelineSettings1757200001000 implements MigrationInterface {
  name = 'PipelineSettings1757200001000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS pipeline_settings (
        key        text PRIMARY KEY,
        value      jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO pipeline_settings (key, value) VALUES ('workers_paused', 'false') ON CONFLICT DO NOTHING;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS pipeline_settings;`);
  }
}
