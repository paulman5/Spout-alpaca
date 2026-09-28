import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ENV, type Env } from '../config/env';
import { Order } from '../orders/entities/order.entity';
import { LedgerService } from '../orders/ledger.service';
import { BROKER_CLIENT, type BrokerClient } from '../broker/broker.types';
import { ChainService } from '../chain/chain.service';
import { ClaimService } from '../worker/claim.service';

export interface ReconcileReport {
  startedAt: string;
  scanned: number;
  repaired: Array<{ order: string; from: string; to: string; reason: string }>;
  alerts: Array<{ order: string; message: string }>;
  errors: Array<{ order: string; error: string }>;
}

/**
 * Three-way comparison: broker vs DB vs chain. Runs on a timer in the
 * `reconciler` role and on demand via `pnpm reconcile` / POST /reconcile.
 * Takes the same row leases as the workers, so it never races them.
 */
@Injectable()
export class ReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReconcileService.name);
  private timer: NodeJS.Timeout | null = null;
  readonly actor = 'reconciler';

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly ds: DataSource,
    private readonly ledger: LedgerService,
    @Inject(BROKER_CLIENT) private readonly broker: BrokerClient,
    private readonly chain: ChainService,
    private readonly claims: ClaimService,
  ) {}

  async onModuleInit() {
    if (this.env.ROLE !== 'reconciler') return;
    if (this.env.RECONCILE_ONCE) {
      const report = await this.run({ minAgeMs: 0 });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(report, null, 2));
      setTimeout(() => process.exit(report.errors.length ? 1 : 0), 100);
      return;
    }
    this.timer = setInterval(() => void this.run().catch((e) => this.log.error(`reconcile failed: ${e}`)), this.env.RECONCILE_INTERVAL_MS);
    this.log.log(`reconciler every ${this.env.RECONCILE_INTERVAL_MS}ms, min age ${this.env.RECONCILE_MIN_AGE_MS}ms`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(opts: { minAgeMs?: number } = {}): Promise<ReconcileReport> {
    const report: ReconcileReport = { startedAt: new Date().toISOString(), scanned: 0, repaired: [], alerts: [], errors: [] };
    const minAgeMs = opts.minAgeMs ?? this.env.RECONCILE_MIN_AGE_MS;

    // 1. Non-terminal orders (ignore their retry schedule; take a lease so workers stay out).
    const open = await this.claims.claim(this.actor, {
      limit: 200,
      ignoreSchedule: true,
      minAgeMs,
      statuses: ['broker_placing', 'broker_placed', 'filled', 'settling', 'refunding'],
    });
    for (const order of open) {
      report.scanned++;
      try {
        await this.reconcileOpen(order, report);
      } catch (e) {
        report.errors.push({ order: key(order), error: String(e) });
      } finally {
        await this.claims.release(order, this.actor);
      }
    }

    // 2. Terminal orders whose PDA should be gone.
    const terminal = await this.ds.getRepository(Order).createQueryBuilder('o')
      .where("o.status IN ('settled','refunded')")
      .andWhere("o.updated_at > now() - interval '1 day'")
      .getMany();
    for (const order of terminal) {
      report.scanned++;
      try {
        if (await this.chain.pdaExists(order.userPubkey, order.orderId)) {
          // Alert once per order, not on every run (a repeated alert would also trip the circuit breaker).
          const existing = (await this.ds.query(
            `SELECT 1 FROM alerts WHERE user_pubkey = $1 AND order_id = $2 AND message LIKE 'DB says%PDA still exists%' AND acknowledged_at IS NULL LIMIT 1`,
            [order.userPubkey, order.orderId],
          )) as unknown[];
          if (existing.length === 0) {
            await this.ds.transaction((m) => this.ledger.alert(m, order, 'critical', `DB says ${order.status} but PendingOrder PDA still exists on-chain`, { settleSignature: order.settleSignature }));
          }
          report.alerts.push({ order: key(order), message: 'terminal in DB but PDA still open' });
        }
      } catch (e) {
        report.errors.push({ order: key(order), error: String(e) });
      }
    }

    if (report.repaired.length || report.alerts.length) this.log.warn(`reconcile: scanned=${report.scanned} repaired=${report.repaired.length} alerts=${report.alerts.length}`);
    else this.log.log(`reconcile: scanned=${report.scanned}, no drift`);
    return report;
  }

  private async reconcileOpen(order: Order, report: ReconcileReport) {
    const from = order.status;
    const repaired = (to: string, reason: string) => report.repaired.push({ order: key(order), from, to, reason });

    // Chain first: a closed PDA is the strongest signal (someone already settled or refunded).
    const pdaOpen = await this.chain.pdaExists(order.userPubkey, order.orderId);
    if (!pdaOpen) {
      const to = order.status === 'refunding' ? 'refunded' : 'settled';
      if (order.status === 'broker_placing' || order.status === 'broker_placed') {
        // Chain closed while we did not even know the fill: record and alert (money moved without our trace).
        await this.ds.transaction(async (m) => {
          await this.ledger.transition(m, order, 'needs_human', 'reconciled_pda_closed_before_fill', this.actor, {}, { previous: from });
          await this.ledger.alert(m, order, 'warning', 'PDA closed on-chain while DB had no fill; verify manually', { previous: from });
        });
        repaired('needs_human', 'pda_closed_before_fill');
        return;
      }
      await this.ds.transaction((m) => this.ledger.transition(m, order, to, 'reconciled_pda_closed', this.actor, { lastError: null }, { previous: from }));
      repaired(to, 'pda_closed');
      return;
    }

    // Broker second: a fill the poller missed, or an order the database never recorded.
    if (order.status === 'broker_placing' || order.status === 'broker_placed') {
      const b = await this.broker.findByClientOrderId(order.clientOrderId);
      if (!b) return; // nothing at the broker yet; the worker will place/retry
      if (b.status === 'filled') {
        await this.ds.transaction((m) =>
          this.ledger.transition(m, order, 'filled', 'reconciled_broker_filled', this.actor, { brokerOrderId: b.brokerOrderId, brokerStatus: b.rawStatus, filledNotional: b.filledNotional, filledQty: b.filledQty, attempts: 0, lastError: null, nextAttemptAt: null }, { previous: from }),
        );
        repaired('filled', 'broker_filled');
      } else if (order.status === 'broker_placing') {
        await this.ds.transaction((m) => this.ledger.transition(m, order, 'broker_placed', 'reconciled_broker_order_found', this.actor, { brokerOrderId: b.brokerOrderId, brokerStatus: b.rawStatus, nextAttemptAt: null }, { previous: from }));
        repaired('broker_placed', 'broker_order_found');
      } else if (b.status === 'rejected' || b.status === 'canceled') {
        await this.ds.transaction((m) => this.ledger.transition(m, order, 'refunding', `reconciled_broker_${b.status}`, this.actor, { brokerStatus: b.rawStatus, attempts: 0, nextAttemptAt: null }, { previous: from }));
        repaired('refunding', `broker_${b.status}`);
      }
      return;
    }

    // filled / settling / refunding with PDA still open: make sure the worker picks it up now.
    if (order.nextAttemptAt && order.nextAttemptAt.getTime() > Date.now() + 5 * 60_000) {
      await this.ds.transaction((m) => this.ledger.note(m, order, 'reconciled_schedule_reset', this.actor, null, { nextAttemptAt: new Date() }));
    }
  }
}

function key(o: Order) {
  return `${o.userPubkey}/${o.orderId}`;
}
