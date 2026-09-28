import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Operational switches shared by all processes. Currently: workers_paused (kill-switch). */
@Entity({ name: 'pipeline_settings' })
export class PipelineSetting {
  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: unknown;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
