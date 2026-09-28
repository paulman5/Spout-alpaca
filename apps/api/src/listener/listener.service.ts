import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ENV, type Env } from '../config/env';
import { ChainService } from '../chain/chain.service';
import { ListenerCursor } from '../orders/entities/listener-cursor.entity';
import { IngestService } from './ingest.service';

const CURSOR_ID = 'orders-lite';

/**
 * Subscribes to program logs over websocket (at-least-once, unordered) and, as a
 * safety net for dropped sockets, periodically backfills with
 * getSignaturesForAddress from the last cursor. Both paths feed IngestService,
 * which makes duplicates harmless.
 *
 * Only the backfill advances the cursor. The websocket path never does: if it did,
 * a newer signature delivered right after a drop would hide an older one that was
 * lost during the drop, and the backfill would never fetch it.
 */
@Injectable()
export class ListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ListenerService.name);
  private subId: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private backfilling = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly chain: ChainService,
    private readonly ingest: IngestService,
    private readonly ds: DataSource,
    @InjectRepository(ListenerCursor) private readonly cursors: Repository<ListenerCursor>,
  ) {}

  async onModuleInit() {
    await this.backfill().catch((e) => this.log.error(`initial backfill failed: ${e}`));
    this.subscribe();
    this.timer = setInterval(() => void this.backfill().catch((e) => this.log.error(`backfill failed: ${e}`)), this.env.LISTENER_BACKFILL_MS);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.subId !== null) await this.chain.connection.removeOnLogsListener(this.subId).catch(() => undefined);
  }

  private subscribe() {
    this.subId = this.chain.connection.onLogs(
      this.chain.programId,
      (logs, ctx) => {
        if (logs.err) return; // a failed transaction emits nothing we act on
        void this.ingest.ingest({ signature: logs.signature, slot: ctx.slot, logs: logs.logs, source: 'ws' }).catch((e) => this.log.error(`ingest ${logs.signature} failed: ${e}`));
      },
      'confirmed', // fast path; the PDA check before settlement covers the rare rollback of a confirmed slot
    );
    this.log.log(`logsSubscribe on ${this.chain.programId.toBase58()} (sub ${this.subId})`);
  }

  /**
   * Pull everything since the cursor (or the last N signatures on first start), oldest first,
   * paginating past the RPC's 1000-signature page. Signatures already captured by the
   * websocket are skipped without an RPC round-trip.
   */
  async backfill(): Promise<number> {
    if (this.backfilling) return 0;
    this.backfilling = true;
    try {
      const cursor = await this.cursors.findOne({ where: { id: CURSOR_ID } });
      const sigs: Array<{ signature: string; slot: number; err: unknown }> = [];
      let before: string | undefined;
      for (;;) {
        const page = await this.chain.connection.getSignaturesForAddress(
          this.chain.programId,
          { until: cursor?.lastSignature ?? undefined, before, limit: cursor ? 1000 : this.env.LISTENER_INITIAL_LIMIT },
          'confirmed',
        );
        sigs.push(...page);
        if (!cursor || page.length < 1000) break;
        before = page[page.length - 1]!.signature;
      }
      if (sigs.length === 0) return 0;

      const ordered = [...sigs].reverse(); // oldest first, so the cursor only ever moves forward
      const known = new Set(
        ((await this.ds.query(`SELECT DISTINCT signature FROM raw_events WHERE signature = ANY($1)`, [ordered.map((s) => s.signature)])) as Array<{ signature: string }>).map((r) => r.signature),
      );
      let fetched = 0;
      for (const s of ordered) {
        if (!s.err && !known.has(s.signature)) {
          await this.ingest.ingestSignature(s.signature, 'backfill');
          fetched++;
          await sleep(this.env.LISTENER_BACKFILL_DELAY_MS); // the public devnet RPC rate-limits getTransaction hard
        }
        // Only the backfill advances the cursor: a fresh websocket event must never hide an older one lost during a drop.
        await this.cursors.upsert({ id: CURSOR_ID, lastSignature: s.signature, lastSlot: String(s.slot) }, ['id']);
      }
      if (fetched) this.log.log(`backfill fetched ${fetched} missing signature(s) of ${ordered.length}`);
      return fetched;
    } finally {
      this.backfilling = false;
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
