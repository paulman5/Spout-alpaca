import { Inject, Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { canTransition, type OrderStatus } from '@spout/shared';
import { ENV, type Env } from '../config/env';
import { Order } from './entities/order.entity';
import { OrderEvent } from './entities/order-event.entity';
import { Alert } from './entities/alert.entity';

export class IllegalTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Illegal transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

/** The row moved under us (another process transitioned it first). The caller must stop and re-read. */
export class StaleOrderError extends Error {
  constructor(order: Order, expected: OrderStatus) {
    super(`Order ${order.userPubkey}/${order.orderId} is no longer in status ${expected}`);
    this.name = 'StaleOrderError';
  }
}

/**
 * The only way an order's status changes. Writes the new projection AND the
 * ledger line inside the caller's transaction, so a crash can never leave one
 * without the other. The UPDATE is fenced on the expected current status, so
 * two processes can never apply the same transition twice even if a lease lapsed.
 */
@Injectable()
export class LedgerService {
  private readonly log = new Logger(LedgerService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  async transition(
    m: EntityManager,
    order: Order,
    to: OrderStatus,
    reason: string,
    actor: string,
    patch: Partial<Order> = {},
    details: Record<string, unknown> | null = null,
  ): Promise<Order> {
    const from = order.status;
    if (from !== to && !canTransition(from, to)) throw new IllegalTransitionError(from, to); // the whitelist in status.ts, enforced

    // Fenced update: only succeeds if the row is still in the state this process last saw.
    const result = await m
      .createQueryBuilder()
      .update(Order)
      .set({ ...patch, status: to })
      .where('user_pubkey = :u AND order_id = :o AND status = :from', { u: order.userPubkey, o: order.orderId, from })
      .execute();
    if (result.affected !== 1) throw new StaleOrderError(order, from); // another process moved it first: write nothing
    Object.assign(order, patch, { status: to });

    // The ledger line, in the same transaction as the update: the story survives any crash.
    await m.insert(OrderEvent, <any>{
      userPubkey: order.userPubkey,
      orderId: order.orderId,
      fromStatus: from,
      toStatus: to,
      reason,
      details,
      actor,
    });
    this.log.log(`${order.userPubkey.slice(0, 6)}/${order.orderId} ${from} -> ${to} (${reason}) by ${actor}`);
    return order;
  }

  /** Ledger line without a status change (retry scheduled, poll result, recovery lookup...). */
  async note(m: EntityManager, order: Order, reason: string, actor: string, details: Record<string, unknown> | null = null, patch: Partial<Order> = {}) {
    if (Object.keys(patch).length) {
      const result = await m
        .createQueryBuilder()
        .update(Order)
        .set(patch)
        .where('user_pubkey = :u AND order_id = :o AND status = :s', { u: order.userPubkey, o: order.orderId, s: order.status })
        .execute();
      if (result.affected !== 1) throw new StaleOrderError(order, order.status);
      Object.assign(order, patch);
    }
    await m.insert(OrderEvent, <any>{
      userPubkey: order.userPubkey,
      orderId: order.orderId,
      fromStatus: order.status,
      toStatus: order.status,
      reason,
      details,
      actor,
    });
  }

  /**
   * Record something a human must look at. Critical alerts also feed the circuit
   * breaker: too many of them in a short window pause every worker (kill-switch),
   * because a burst of dead letters usually means a systemic problem, not a single order.
   */
  async alert(
    m: EntityManager,
    order: Order | null,
    severity: 'warning' | 'critical',
    message: string,
    details: Record<string, unknown> | null = null,
  ) {
    await m.insert(Alert, <any>{
      userPubkey: order?.userPubkey ?? null,
      orderId: order?.orderId ?? null,
      severity,
      message,
      details,
    });
    this.log.error(`ALERT[${severity}] ${message} ${order ? `${order.userPubkey.slice(0, 6)}/${order.orderId}` : ''} ${details ? JSON.stringify(details) : ''}`);
    if (severity === 'critical' && this.env.CIRCUIT_BREAKER_ALERTS > 0) await this.checkCircuitBreaker(m);
  }

  private async checkCircuitBreaker(m: EntityManager) {
    const rows = (await m.query(
      `SELECT count(*)::int AS n FROM alerts WHERE severity = 'critical' AND created_at > now() - ($1 || ' milliseconds')::interval`,
      [String(this.env.CIRCUIT_BREAKER_WINDOW_MS)],
    )) as Array<{ n: number }>;
    const n = rows[0]?.n ?? 0;
    if (n < this.env.CIRCUIT_BREAKER_ALERTS) return;
    const paused = (await m.query(`SELECT value FROM pipeline_settings WHERE key = 'workers_paused'`)) as Array<{ value: unknown }>;
    if (paused[0]?.value === true) return;
    await m.query(`INSERT INTO pipeline_settings (key, value) VALUES ('workers_paused', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()`);
    await m.insert(Alert, <any>{
      userPubkey: null,
      orderId: null,
      severity: 'critical',
      message: `Circuit breaker tripped: ${n} critical alerts in ${Math.round(this.env.CIRCUIT_BREAKER_WINDOW_MS / 60000)} min; workers paused. Investigate, then POST /workers/resume.`,
      details: { criticalAlerts: n, windowMs: this.env.CIRCUIT_BREAKER_WINDOW_MS },
    });
    this.log.error(`CIRCUIT BREAKER: ${n} critical alerts in window -> workers paused`);
  }
}
