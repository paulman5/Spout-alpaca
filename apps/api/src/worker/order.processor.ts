import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ENV, type Env } from '../config/env';
import { Order } from '../orders/entities/order.entity';
import { LedgerService, StaleOrderError } from '../orders/ledger.service';
import { BROKER_CLIENT, type BrokerClient, type BrokerOrder } from '../broker/broker.types';
import { BrokerError } from '../broker/broker.errors';
import { ChainService } from '../chain/chain.service';
import { ChainError } from '../chain/chain.errors';
import { backoffMs, classifyFailure, describeError, isExhausted, type RetryConfig } from './retry.policy';

type StepOutcome = 'continue' | 'wait' | 'done';

/**
 * One order, one step at a time. Each step runs in its own transaction and ends
 * with a ledger transition, so a crash between steps leaves a consistent row that
 * the next claim (by any worker) resumes from.
 *
 * Crash safety: `broker_placing` records the *intent* before the broker call; on
 * resume the step first asks the broker `by_client_order_id` and adopts what it
 * finds, so an accepted-but-unrecorded order is never placed twice.
 *
 * Money rule, applied everywhere: an order the broker filled (even partially) is
 * never refunded. It is settled for the filled amount, or handed to a human.
 */
@Injectable()
export class OrderProcessor {
  private readonly log = new Logger(OrderProcessor.name);
  private readonly retry: RetryConfig;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly ds: DataSource,
    private readonly ledger: LedgerService,
    @Inject(BROKER_CLIENT) private readonly broker: BrokerClient,
    private readonly chain: ChainService,
  ) {
    this.retry = { maxAttempts: env.RETRY_MAX_ATTEMPTS, baseMs: env.RETRY_BASE_MS, maxMs: env.RETRY_MAX_MS };
  }

  /** Drive the order as far as it can go right now. */
  async process(order: Order, actor: string): Promise<void> {
    for (let guard = 0; guard < 12; guard++) {
      let outcome: StepOutcome;
      try {
        outcome = await this.step(order, actor);
      } catch (err) {
        if (err instanceof StaleOrderError) {
          // Someone else moved this order (lapsed lease, reconciler): stop touching it.
          this.log.warn(err.message);
          return;
        }
        await this.onFailure(order, err, actor);
        return;
      }
      if (outcome !== 'continue') return;
    }
  }

  private async step(order: Order, actor: string): Promise<StepOutcome> {
    switch (order.status) {
      case 'recorded':
        return this.stepRecorded(order, actor);
      case 'broker_placing':
        return this.stepBrokerPlacing(order, actor);
      case 'broker_placed':
        return this.stepBrokerPlaced(order, actor);
      case 'filled':
        return this.stepFilled(order, actor);
      case 'settling':
        return this.closeOnChain(order, actor, 'fulfill');
      case 'refunding':
        return this.stepRefunding(order, actor);
      default:
        return 'done';
    }
  }

  // ---- steps -------------------------------------------------------------

  /**
   * Two guards before any money moves:
   *  - the PDA must still exist (a replayed/reordered event for an order that was already
   *    fulfilled or refunded on-chain must never trigger a trade);
   *  - the notional must be under MAX_ORDER_USDC (bigger orders need a human).
   */
  private async stepRecorded(order: Order, actor: string): Promise<StepOutcome> {
    if (!(await this.chain.pdaExists(order.userPubkey, order.orderId))) {
      // The on-chain ticket is already closed (replayed or reordered event): no trade, converge to what the chain says.
      const closed = await this.closedBy(order);
      await this.ds.transaction(async (m) => {
        if (closed) {
          await this.ledger.transition(m, order, closed.outcome, 'pda_closed_before_processing', actor, closed.signature ? { settleSignature: closed.signature } : {}, { observed: closed.outcome, signature: closed.signature });
        } else {
          await this.ledger.transition(m, order, 'needs_human', 'pda_closed_before_processing', actor, {}, { observed: 'unknown' });
          await this.ledger.alert(m, order, 'warning', 'PendingOrder PDA already closed before we processed the order; no trade placed', null);
        }
      });
      return 'done';
    }
    const cap = this.env.MAX_ORDER_USDC;
    if (cap > 0 && Number(order.amount) > cap * 1e6) {
      // Above the automatic limit: a human approves before any money moves.
      await this.ds.transaction(async (m) => {
        await this.ledger.transition(m, order, 'needs_human', 'order_exceeds_cap', actor, {}, { amountUsdc: Number(order.amount) / 1e6, capUsdc: cap });
        await this.ledger.alert(m, order, 'warning', `Order above MAX_ORDER_USDC (${cap}); manual approval required before trading`, null);
      });
      return 'done';
    }
    // The INTENT, written before the broker is called. A crash after this line is recoverable by any worker.
    await this.ds.transaction((m) => this.ledger.transition(m, order, 'broker_placing', 'broker_intent_recorded', actor, { attempts: 0, lastError: null }, { clientOrderId: order.clientOrderId }));
    return 'continue';
  }

  /** What closed the PDA: first the events we captured, then the chain itself. */
  private async closedBy(order: Order): Promise<{ outcome: 'settled' | 'refunded'; signature: string | null } | null> {
    const rows = (await this.ds.query(`SELECT event_name, signature FROM raw_events WHERE user_pubkey = $1 AND order_id = $2`, [order.userPubkey, order.orderId])) as Array<{ event_name: string; signature: string }>;
    const fulfilled = rows.find((r) => r.event_name === 'BuyOrderFulfilled');
    if (fulfilled) return { outcome: 'settled', signature: fulfilled.signature };
    const refunded = rows.find((r) => r.event_name === 'BuyOrderRefunded');
    if (refunded) return { outcome: 'refunded', signature: refunded.signature };
    try {
      return await this.chain.findCloseEvent(order.userPubkey, order.orderId);
    } catch (e) {
      this.log.warn(`could not read the closing transaction of ${order.userPubkey.slice(0, 6)}/${order.orderId}: ${describeError(e)}`);
      return null;
    }
  }

  private async stepBrokerPlacing(order: Order, actor: string): Promise<StepOutcome> {
    // 1. Recovery lookup: did a previous attempt already reach the broker? (crash between the broker's 202 and our write)
    const existing = await this.broker.findByClientOrderId(order.clientOrderId);
    if (existing) {
      await this.ds.transaction(async (m) => {
        await this.ledger.note(m, order, 'broker_recovery_found', actor, { brokerOrderId: existing.brokerOrderId, status: existing.rawStatus });
        await this.adoptBrokerOrder(m, order, existing, actor, 'broker_recovered');
      });
      return 'continue';
    }

    // 2. Place. client_order_id is deterministic, so a duplicate answer (409, or Alpaca's 422) means "already placed": adopt it.
    let placed: { order: BrokerOrder; duplicate: boolean };
    try {
      placed = await this.broker.placeOrder({
        clientOrderId: order.clientOrderId,
        symbol: order.ticker,
        side: 'buy',
        notional: usdcToNotional(order.amount),
      });
    } catch (err) {
      if (err instanceof BrokerError && err.kind === 'permanent') {
        // Market closed, invalid symbol...: never retried, the user is refunded on-chain.
        await this.ds.transaction((m) =>
          this.ledger.transition(m, order, 'refunding', 'broker_rejected', actor, { attempts: 0, lastError: err.message, brokerStatus: err.code ?? 'rejected' }, { code: err.code, httpStatus: err.httpStatus, message: err.message }),
        );
        return 'continue';
      }
      throw err; // transient (5xx, timeout, 429...): onFailure schedules a retry with backoff
    }

    if (this.env.WORKER_CRASH_POINT === 'after_broker_accept') {
      // Scenario B: broker accepted, DB not yet written. Die here.
      this.log.error(`WORKER_CRASH_POINT=after_broker_accept: broker accepted ${placed.order.brokerOrderId}, exiting before DB write`);
      process.exit(137);
    }

    await this.ds.transaction((m) => this.adoptBrokerOrder(m, order, placed.order, actor, placed.duplicate ? 'broker_duplicate_adopted' : 'broker_accepted'));
    return 'continue';
  }

  private async adoptBrokerOrder(m: EntityManager, order: Order, b: BrokerOrder, actor: string, reason: string) {
    const patch: Partial<Order> = { brokerOrderId: b.brokerOrderId, brokerStatus: b.rawStatus, attempts: 0, lastError: null, nextAttemptAt: null };
    const details = { brokerOrderId: b.brokerOrderId, brokerStatus: b.rawStatus, broker: this.broker.name };
    if (b.status === 'filled') {
      await this.markFilled(m, order, b, actor, `${reason}_filled`);
    } else if (b.status === 'rejected' || b.status === 'canceled') {
      await this.ledger.transition(m, order, 'refunding', `${reason}_${b.status}`, actor, patch, details);
    } else {
      await this.ledger.transition(m, order, 'broker_placed', reason, actor, { ...patch, nextAttemptAt: new Date(Date.now() + this.env.BROKER_POLL_MS) }, details);
    }
  }

  /** Filled (fully or partially) -> settle for what was actually bought. Partial fills are flagged for the operator. */
  private async markFilled(m: EntityManager, order: Order, b: BrokerOrder, actor: string, reason: string) {
    const patch: Partial<Order> = { brokerOrderId: b.brokerOrderId, brokerStatus: b.rawStatus, filledNotional: b.filledNotional, filledQty: b.filledQty, attempts: 0, lastError: null, nextAttemptAt: null };
    await this.ledger.transition(m, order, 'filled', b.partial ? `${reason}_partial` : reason, actor, patch, { filledNotional: b.filledNotional, filledQty: b.filledQty, rawStatus: b.rawStatus, partial: !!b.partial });
    if (b.partial) {
      await this.ledger.alert(m, order, 'warning', 'Broker closed the order after a partial fill; settling for the filled amount only (remainder stays with the user)', {
        filledNotional: b.filledNotional,
        requestedUsdc: Number(order.amount) / 1e6,
      });
    }
  }

  private async stepBrokerPlaced(order: Order, actor: string): Promise<StepOutcome> {
    const b = await this.broker.getOrder(order.brokerOrderId!); // poll the broker
    if (b.status === 'filled') {
      await this.ds.transaction((m) => this.markFilled(m, order, b, actor, 'broker_filled')); // partial fills count as filled (flagged)
      return 'continue';
    }
    if (b.status === 'rejected' || b.status === 'canceled') {
      await this.ds.transaction((m) => this.ledger.transition(m, order, 'refunding', `broker_${b.status}_after_accept`, actor, { brokerStatus: b.rawStatus, attempts: 0, lastError: null }, { rawStatus: b.rawStatus, rejectReason: b.rejectReason }));
      return 'continue';
    }
    // Still open: poll again later. A successful poll resets the retry budget, so only
    // consecutive failures count (an order can legitimately sit for hours before the market opens).
    await this.ds.getRepository(Order).update(
      { userPubkey: order.userPubkey, orderId: order.orderId, status: 'broker_placed' },
      { brokerStatus: b.rawStatus, attempts: 0, lastError: null, nextAttemptAt: new Date(Date.now() + this.env.BROKER_POLL_MS) },
    );
    return 'wait';
  }

  private async stepFilled(order: Order, actor: string): Promise<StepOutcome> {
    await this.ds.transaction((m) => this.ledger.transition(m, order, 'settling', 'settlement_started', actor, { attempts: 0, lastError: null }, { actualUsdc: actualUsdc(order) }));
    return 'continue';
  }

  /**
   * Refund path. Before touching the chain, make sure the broker really holds nothing:
   * cancel if still open, then re-read until the broker reports a final state. A fill that
   * happens during the cancel window wins: the order is settled, never refunded.
   */
  private async stepRefunding(order: Order, actor: string): Promise<StepOutcome> {
    if (order.brokerOrderId && order.brokerStatus !== 'canceled' && order.brokerStatus !== 'rejected') {
      const b = await this.cancelAndConfirm(order.brokerOrderId, actor, order); // cancel, then re-read until the broker reports a final state
      if (b.status === 'filled') {
        // Filled during the cancel window: the money rule wins, no refund.
        await this.ds.transaction(async (m) => {
          await this.ledger.transition(m, order, 'needs_human', 'filled_at_broker_while_refunding', actor, { brokerStatus: b.rawStatus, filledNotional: b.filledNotional, filledQty: b.filledQty });
          await this.ledger.alert(m, order, 'critical', 'Broker FILLED an order we were about to refund; do not refund, settle manually', { brokerOrderId: b.brokerOrderId });
        });
        return 'done';
      }
      if (b.status === 'accepted') {
        // Cancel not confirmed yet: treat as transient and come back.
        throw new BrokerError('transient', `cancel of ${b.brokerOrderId} not confirmed yet (status ${b.rawStatus})`, undefined, 'cancel_pending');
      }
      await this.ds.transaction((m) => this.ledger.note(m, order, 'broker_cancel_confirmed', actor, { brokerOrderId: b.brokerOrderId, rawStatus: b.rawStatus }, { brokerStatus: b.rawStatus }));
    }
    return this.closeOnChain(order, actor, 'refund');
  }

  /** DELETE, then poll the order until it leaves the open state (bounded). Returns the last observed state. */
  private async cancelAndConfirm(brokerOrderId: string, actor: string, order: Order): Promise<BrokerOrder> {
    let b = await this.broker.getOrder(brokerOrderId);
    if (b.status !== 'accepted') return b;
    await this.broker.cancelOrder(brokerOrderId);
    await this.ds.transaction((m) => this.ledger.note(m, order, 'broker_cancel_requested', actor, { brokerOrderId }));
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      b = await this.broker.getOrder(brokerOrderId);
      if (b.status !== 'accepted') return b;
    }
    return b;
  }

  /**
   * Shared by fulfill and refund. Order of operations:
   *   a) a signature was persisted earlier -> check whether it landed (lost confirmation)
   *   b) PDA already gone -> already settled (by us earlier, or by the reconciler)
   *   c) send; 3012 at any point == already settled
   */
  private async closeOnChain(order: Order, actor: string, kind: 'fulfill' | 'refund'): Promise<StepOutcome> {
    const terminal = kind === 'fulfill' ? 'settled' : 'refunded';

    // Under CHAIN_FAULT=drop_confirmation (scenario D) we also pretend the RPC cannot tell us
    // anything about the earlier send, so the retry has to re-send and rely on Anchor 3012.
    const rpcBlind = this.env.CHAIN_FAULT === 'drop_confirmation';
    if (order.settleSignature && !rpcBlind) {
      const st = await this.chain.signatureStatus(order.settleSignature);
      if (st === 'confirmed') {
        await this.ds.transaction((m) => this.ledger.transition(m, order, terminal, 'settlement_confirmed_on_recheck', actor, { lastError: null }, { signature: order.settleSignature }));
        return 'done';
      }
      await this.ds.transaction((m) => this.ledger.note(m, order, 'settlement_signature_recheck', actor, { signature: order.settleSignature, status: st }));
    }
    if (!rpcBlind && !(await this.chain.pdaExists(order.userPubkey, order.orderId))) {
      await this.ds.transaction((m) => this.ledger.transition(m, order, terminal, 'pda_already_closed', actor, { lastError: null }, { signature: order.settleSignature }));
      return 'done';
    }

    // The first signature we ever sent is the one that may have landed: never overwrite it.
    // Called by ChainService after signing and BEFORE sending: a lost confirmation can then be re-checked instead of blindly re-sent.
    const persist = async (sig: string) => {
      const patch: Partial<Order> = order.settleSignature ? {} : { settleSignature: sig }; // the first signature ever sent is the one that may have landed
      await this.ds.transaction((m) => this.ledger.note(m, order, `${kind}_tx_signed`, actor, { signature: sig, attempt: order.attempts + 1 }, patch));
      if (this.env.WORKER_CRASH_POINT === 'after_settle_sign') {
        this.log.error('WORKER_CRASH_POINT=after_settle_sign: exiting after persisting the signature, before the send');
        process.exit(137);
      }
    };

    try {
      const res =
        kind === 'fulfill'
          ? await this.chain.fulfillBuyOrder(order.userPubkey, order.orderId, actualUsdc(order), persist)
          : await this.chain.refundBuyOrder(order.userPubkey, order.orderId, persist);
      await this.ds.transaction((m) => this.ledger.transition(m, order, terminal, `${kind}_confirmed`, actor, { settleSignature: res.signature, lastError: null }, { signature: res.signature, actualUsdc: kind === 'fulfill' ? actualUsdc(order) : undefined }));
      return 'done';
    } catch (err) {
      if (err instanceof ChainError && err.kind === 'already_settled') {
        // Anchor 3012 AccountNotInitialized: the PDA is already closed. That is success, not failure.
        await this.ds.transaction((m) => this.ledger.transition(m, order, terminal, 'already_settled_3012', actor, { lastError: null }, { attemptedSignature: err.signature, landedSignature: order.settleSignature, message: err.message }));
        return 'done';
      }
      if (err instanceof ChainError && err.kind === 'permanent') {
        await this.ds.transaction(async (m) => {
          await this.ledger.transition(m, order, 'needs_human', `${kind}_rejected_by_program`, actor, { lastError: err.message }, { message: err.message });
          await this.ledger.alert(m, order, 'critical', `On-chain ${kind} permanently rejected`, { message: err.message });
        });
        return 'done';
      }
      throw err;
    }
  }

  // ---- failure handling --------------------------------------------------

  private async onFailure(order: Order, err: unknown, actor: string): Promise<void> {
    const kind = classifyFailure(err);
    const message = describeError(err);
    if (kind === 'permanent') {
      // Should have been handled inside the step; treat as a bug -> human.
      await this.ds.transaction(async (m) => {
        await this.ledger.transition(m, order, 'needs_human', 'unexpected_permanent_error', actor, { lastError: message }, { message });
        await this.ledger.alert(m, order, 'critical', 'Unexpected permanent error', { message, status: order.status });
      });
      return;
    }

    const attempts = order.attempts + 1;
    if (!isExhausted(attempts, this.retry)) {
      // Transient failure under the budget: no state change, just a ledger line and a next attempt time.
      const delay = backoffMs(attempts, this.retry);
      await this.ds.transaction((m) =>
        this.ledger.note(m, order, 'retry_scheduled', actor, { attempt: attempts, maxAttempts: this.retry.maxAttempts, delayMs: delay, error: message }, { attempts, lastError: message, nextAttemptAt: new Date(Date.now() + delay) }),
      );
      this.log.warn(`${order.userPubkey.slice(0, 6)}/${order.orderId} ${order.status} attempt ${attempts}/${this.retry.maxAttempts} failed (${message}); retry in ${delay}ms`);
      return;
    }
    await this.exhaust(order, message, actor);
  }

  /**
   * Retries exhausted. Revert deliberately: confirm with the broker whether a
   * trade exists before touching the chain. A filled trade is never abandoned.
   */
  private async exhaust(order: Order, lastError: string, actor: string): Promise<void> {
    const details = { lastError, attempts: this.retry.maxAttempts };
    if (order.status === 'broker_placing' || order.status === 'broker_placed') {
      let b: BrokerOrder | null = null;
      try {
        b = await this.broker.findByClientOrderId(order.clientOrderId);
      } catch (e) {
        // Broker still unreachable: we cannot prove absence, so escalate rather than refund blindly.
        await this.ds.transaction(async (m) => {
          await this.ledger.transition(m, order, 'needs_human', 'retries_exhausted_broker_unreachable', actor, { lastError }, { ...details, lookupError: describeError(e) });
          await this.ledger.alert(m, order, 'critical', 'Retries exhausted and broker lookup failed; cannot decide refund safely', details);
        });
        return;
      }
      if (b === null || b.status === 'rejected' || b.status === 'canceled') {
        // The broker holds nothing for this order: refunding is safe.
        await this.ds.transaction(async (m) => {
          await this.ledger.transition(m, order, 'refunding', 'retries_exhausted_no_broker_trade', actor, { attempts: 0, lastError, brokerStatus: b?.rawStatus ?? null }, { ...details, brokerLookup: b?.rawStatus ?? 'not_found' });
          await this.ledger.alert(m, order, 'warning', 'Retries exhausted with no broker trade; refunding on-chain', details);
        });
        return;
      }
      if (b.status === 'filled') {
        // The user's money bought shares: never refund, never abandon. Dead-letter for a human.
        await this.ds.transaction(async (m) => {
          await this.ledger.transition(m, order, 'needs_human', 'retries_exhausted_but_broker_filled', actor, { lastError, brokerOrderId: b!.brokerOrderId, brokerStatus: b!.rawStatus, filledNotional: b!.filledNotional, filledQty: b!.filledQty }, details);
          await this.ledger.alert(m, order, 'critical', 'DEAD LETTER: broker trade FILLED but pipeline failed; user paid real money, settle manually', { brokerOrderId: b!.brokerOrderId });
        });
        return;
      }
      // Accepted, not filled: hand the open order to the refund path, which cancels and re-checks before any refund.
      await this.ds.transaction((m) =>
        this.ledger.transition(m, order, 'refunding', 'retries_exhausted_broker_open', actor, { attempts: 0, lastError, brokerOrderId: b!.brokerOrderId, brokerStatus: b!.rawStatus }, details),
      );
      return;
    }

    // settling / refunding / anything else: the trade side is done, only the chain is failing -> human.
    await this.ds.transaction(async (m) => {
      await this.ledger.transition(m, order, 'needs_human', `retries_exhausted_${order.status}`, actor, { lastError }, details);
      await this.ledger.alert(m, order, 'critical', `Retries exhausted during ${order.status}; on-chain settlement needs a human`, details);
    });
  }
}

/** on-chain usdc_amount (6 dp) -> broker notional in dollars, 2 dp */
export function usdcToNotional(amount: string): string {
  return (Number(amount) / 1e6).toFixed(2);
}

/**
 * What we report on-chain as actual_usdc: the broker's filled notional (6 dp), never more
 * than the amount the user escrowed, falling back to the requested amount.
 */
export function actualUsdc(order: Order): string {
  if (order.filledNotional) {
    const filled = Math.round(Number(order.filledNotional) * 1e6);
    return String(Math.min(filled, Number(order.amount)));
  }
  return order.amount;
}
