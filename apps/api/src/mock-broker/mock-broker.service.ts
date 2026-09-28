import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BrokerOrder } from '../broker/broker.types';
import { ENV, type Env } from '../config/env';

export type FaultMode = 'none' | 'http500' | 'slow' | 'market_closed' | 'flaky';

export interface FaultState {
  mode: FaultMode;
  /** epoch ms; fault auto-clears after this */
  until: number | null;
  /** 'slow' answers after a random delay in [slowMinMs, slowMaxMs] */
  slowMinMs: number;
  slowMaxMs: number;
  /** for 'flaky': probability of a 500 per request */
  failRate: number;
  fillDelayMs: number;
  /** seed of the deterministic PRNG behind 'flaky' and 'slow' */
  seed: number;
}

interface MockOrder extends BrokerOrder {
  symbol: string;
  side: 'buy' | 'sell';
  notional: string;
  createdAt: string;
  updatedAt: string;
}

export class MockRejection extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** mulberry32: tiny seeded PRNG so a "random" failure run can be replayed exactly. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * In-memory broker with the same contract as Alpaca (from the worker's point of
 * view) plus fault injection. Initial faults come from env (MOCK_FAULT_MODE, MOCK_SEED...)
 * and can be changed at runtime through POST /admin/faults.
 */
@Injectable()
export class MockBrokerService {
  private readonly log = new Logger(MockBrokerService.name);
  private readonly orders = new Map<string, MockOrder>();
  private readonly byClientId = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private requestCount = 0;
  private rand: () => number;
  faults: FaultState;

  constructor(@Optional() @Inject(ENV) env?: Env) {
    this.faults = defaultFaults(env);
    this.rand = seededRandom(this.faults.seed);
    if (this.faults.mode !== 'none') this.log.warn(`initial fault mode from env: ${JSON.stringify(this.faults)}`);
  }

  /** Apply the active fault to any request. Throws to produce a 500, delays for 'slow'. */
  async gate(): Promise<void> {
    this.requestCount++;
    if (this.faults.until !== null && Date.now() > this.faults.until) {
      this.log.warn(`fault ${this.faults.mode} expired -> none`);
      this.faults = { ...this.faults, mode: 'none', until: null };
    }
    switch (this.faults.mode) {
      case 'http500':
        throw new Error('injected 500');
      case 'flaky':
        if (this.rand() < this.faults.failRate) throw new Error('injected flaky 500');
        return;
      case 'slow': {
        const ms = Math.round(this.faults.slowMinMs + this.rand() * Math.max(0, this.faults.slowMaxMs - this.faults.slowMinMs));
        await new Promise((r) => setTimeout(r, ms));
        return;
      }
      default:
        return;
    }
  }

  place(input: { client_order_id: string; symbol: string; side: 'buy' | 'sell'; notional: string }): { order: MockOrder; duplicate: boolean } {
    const existingId = this.byClientId.get(input.client_order_id);
    if (existingId) return { order: this.orders.get(existingId)!, duplicate: true }; // the controller answers 409 with the original order

    if (this.faults.mode === 'market_closed') {
      throw new MockRejection('market_closed', 'market is closed; notional orders are not accepted outside regular trading hours');
    }
    if (!/^[A-Z.]{1,8}$/.test(input.symbol)) throw new MockRejection('invalid_symbol', `invalid symbol ${input.symbol}`);

    const now = new Date().toISOString();
    const order: MockOrder = {
      brokerOrderId: randomUUID(),
      clientOrderId: input.client_order_id,
      status: 'accepted',
      rawStatus: 'accepted',
      filledNotional: null,
      filledQty: null,
      rejectReason: null,
      symbol: input.symbol,
      side: input.side,
      notional: input.notional,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(order.brokerOrderId, order);
    this.byClientId.set(order.clientOrderId, order.brokerOrderId);
    this.timers.set(
      order.brokerOrderId,
      setTimeout(() => this.fill(order.brokerOrderId), this.faults.fillDelayMs), // fills a few seconds later, like a real broker
    );
    this.log.log(`accepted ${order.brokerOrderId} (${order.clientOrderId}) ${order.side} ${order.symbol} $${order.notional}`);
    return { order, duplicate: false };
  }

  fill(brokerOrderId: string): MockOrder | null {
    const o = this.orders.get(brokerOrderId);
    if (!o || o.status !== 'accepted') return o ?? null;
    const price = mockPrice(o.symbol);
    o.status = 'filled';
    o.rawStatus = 'filled';
    o.filledNotional = Number(o.notional).toFixed(6);
    o.filledQty = (Number(o.notional) / price).toFixed(9);
    o.updatedAt = new Date().toISOString();
    this.log.log(`filled ${o.brokerOrderId} qty=${o.filledQty} @ ${price}`);
    return o;
  }

  /** Simulate the broker rejecting an already-accepted order (e.g. halted symbol). */
  reject(brokerOrderId: string, reason = 'rejected_by_exchange'): MockOrder | null {
    const o = this.orders.get(brokerOrderId);
    if (!o || o.status !== 'accepted') return o ?? null;
    clearTimeout(this.timers.get(brokerOrderId));
    o.status = 'rejected';
    o.rawStatus = 'rejected';
    o.rejectReason = reason;
    o.updatedAt = new Date().toISOString();
    return o;
  }

  get(brokerOrderId: string): MockOrder | null {
    return this.orders.get(brokerOrderId) ?? null;
  }

  findByClientId(clientOrderId: string): MockOrder | null {
    const id = this.byClientId.get(clientOrderId);
    return id ? (this.orders.get(id) ?? null) : null;
  }

  cancel(brokerOrderId: string): MockOrder | null {
    const o = this.orders.get(brokerOrderId);
    if (!o) return null;
    if (o.status === 'accepted') {
      clearTimeout(this.timers.get(brokerOrderId));
      o.status = 'canceled';
      o.rawStatus = 'canceled';
      o.updatedAt = new Date().toISOString();
    }
    return o;
  }

  setFaults(patch: Partial<FaultState> & { durationMs?: number; slowMs?: number }): FaultState {
    const { durationMs, slowMs, ...rest } = patch;
    if (slowMs !== undefined) {
      rest.slowMinMs = slowMs;
      rest.slowMaxMs = slowMs;
    }
    this.faults = { ...this.faults, ...rest, until: durationMs ? Date.now() + durationMs : null };
    if (rest.seed !== undefined) this.rand = seededRandom(rest.seed);
    this.log.warn(`faults -> ${JSON.stringify(this.faults)}`);
    return this.faults;
  }

  state() {
    return {
      faults: this.faults,
      requestCount: this.requestCount,
      orders: [...this.orders.values()],
    };
  }

  countByClientId(clientOrderId: string): number {
    return [...this.orders.values()].filter((o) => o.clientOrderId === clientOrderId).length;
  }

  reset() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.orders.clear();
    this.byClientId.clear();
    this.requestCount = 0;
    this.faults = defaultFaults();
    this.rand = seededRandom(this.faults.seed);
  }
}

function defaultFaults(env?: Env): FaultState {
  return {
    mode: env?.MOCK_FAULT_MODE ?? 'none',
    until: null,
    slowMinMs: env?.MOCK_SLOW_MIN_MS ?? 2000,
    slowMaxMs: env?.MOCK_SLOW_MAX_MS ?? 10000,
    failRate: env?.MOCK_FAIL_RATE ?? 0.5,
    fillDelayMs: env?.MOCK_FILL_DELAY_MS ?? 3000,
    seed: env?.MOCK_SEED ?? 42,
  };
}

function mockPrice(symbol: string): number {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return 50 + h / 2; // 50..550, deterministic per symbol
}
