import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineSetting } from './entities/pipeline-setting.entity';

/**
 * Kill-switch for the workers. Pausing lets an operator stop all broker/chain
 * side effects instantly (incident response) without killing processes; it is
 * also how the chaos scenarios hand one order to a purposely-broken worker.
 */
@Injectable()
export class PipelineControlService {
  constructor(@InjectRepository(PipelineSetting) private readonly settings: Repository<PipelineSetting>) {}

  async isPaused(): Promise<boolean> {
    const row = await this.settings.findOne({ where: { key: 'workers_paused' } });
    return row?.value === true;
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.settings.upsert({ key: 'workers_paused', value: paused }, ['key']);
  }
}
