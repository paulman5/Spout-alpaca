import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { ClaimService } from './claim.service';
import { OrderProcessor } from './order.processor';
import { PipelineControlService } from '../orders/pipeline-control.service';

/** Claim -> process -> release loop. Safe to run any number of instances. */
@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WorkerService.name);
  readonly workerId: string;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly claims: ClaimService,
    private readonly processor: OrderProcessor,
    private readonly control: PipelineControlService,
  ) {
    // Always unique per process: a shared WORKER_ID across replicas would let two workers claim the same lease.
    this.workerId = `${env.WORKER_ID || hostname()}:${process.pid}:${randomBytes(2).toString('hex')}`;
  }

  onModuleInit() {
    this.running = true;
    this.loop = this.run();
    this.log.log(`worker ${this.workerId} started (broker=${this.env.BROKER}, poll=${this.env.WORKER_POLL_MS}ms, lease=${this.env.LEASE_SECONDS}s, crash_point=${this.env.WORKER_CRASH_POINT || 'none'}, chain_fault=${this.env.CHAIN_FAULT || 'none'})`);
  }

  async onModuleDestroy() {
    this.running = false;
    await this.loop;
  }

  private async run() {
    while (this.running) {
      let worked = 0;
      try {
        worked = await this.tick();
      } catch (e) {
        this.log.error(`tick failed: ${e}`);
      }
      if (worked === 0) await sleep(this.env.WORKER_POLL_MS);
    }
  }

  async tick(): Promise<number> {
    if (!this.env.WORKER_IGNORE_PAUSE && (await this.control.isPaused())) return 0; // kill switch, read from Postgres before every batch
    const batch = await this.claims.claim(this.workerId);
    for (const order of batch) {
      const hb = setInterval(() => void this.claims.heartbeat(order, this.workerId), (this.env.LEASE_SECONDS * 1000) / 3); // keep the lease alive while a step runs
      try {
        await this.processor.process(order, `worker:${this.workerId}`);
      } finally {
        clearInterval(hb);
        await this.claims.release(order, this.workerId);
      }
    }
    return batch.length;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
