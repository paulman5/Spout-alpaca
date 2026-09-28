import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import type { BrokerClient, BrokerOrder, PlaceOrderRequest, PlaceOrderResult } from '../broker.types';
import { BrokerError } from '../broker.errors';
import { httpJson } from '../http';

interface AlpacaOrder {
  id: string;
  client_order_id: string;
  status: string;
  filled_qty?: string | null;
  filled_avg_price?: string | null;
  notional?: string | null;
  qty?: string | null;
  symbol: string;
}

/**
 * Real Alpaca Broker API (sandbox). OAuth2 client-credentials token, cached and
 * refreshed a minute before expiry. Only the endpoints the pipeline needs.
 */
@Injectable()
export class AlpacaBrokerClient implements BrokerClient {
  readonly name = 'alpaca';
  private readonly log = new Logger(AlpacaBrokerClient.name);
  private token: { value: string; expiresAt: number } | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {
    if (!env.ALPACA_CLIENT_ID || !env.ALPACA_CLIENT_SECRET) {
      throw new Error('BROKER=alpaca requires ALPACA_CLIENT_ID and ALPACA_CLIENT_SECRET');
    }
    if (!env.ALPACA_ACCOUNT_ID) {
      throw new Error('BROKER=alpaca requires ALPACA_ACCOUNT_ID (run: pnpm alpaca-account)');
    }
  }

  private get accountId(): string {
    return this.env.ALPACA_ACCOUNT_ID!;
  }

  async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.env.ALPACA_CLIENT_ID!,
      client_secret: this.env.ALPACA_CLIENT_SECRET!,
    });
    const res = await httpJson(this.env.ALPACA_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = res.json<{ access_token: string; expires_in?: number }>();
    const ttl = (json.expires_in ?? 900) * 1000;
    this.token = { value: json.access_token, expiresAt: Date.now() + ttl };
    this.log.debug(`alpaca token refreshed, ttl ${Math.round(ttl / 1000)}s`);
    return json.access_token;
  }

  /** One 401 is answered by a forced token refresh and a single retry; a second 401 surfaces as transient. */
  private async request(path: string, init: RequestInit & { allowStatuses?: number[] } = {}) {
    const call = async (force: boolean) => {
      const token = await this.accessToken(force);
      return httpJson(`${this.env.ALPACA_BASE_URL}${path}`, {
        ...init,
        allowStatuses: [...(init.allowStatuses ?? []), 401],
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
        timeoutMs: 15_000,
      });
    };
    let res = await call(false);
    if (res.status === 401) res = await call(true);
    if (res.status === 401) throw new BrokerError('transient', 'alpaca rejected the access token twice', 401, 'auth');
    return res;
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const res = await this.request(`/v1/trading/accounts/${this.accountId}/orders`, {
      method: 'POST',
      body: JSON.stringify({
        symbol: req.symbol,
        side: req.side,
        type: 'market',
        time_in_force: 'day',
        notional: req.notional,
        client_order_id: req.clientOrderId,
      }),
      allowStatuses: [409, 422, 403],
    });
    // Duplicate client_order_id: the exactly-once backstop. The assignment spec says 409;
    // the real sandbox answers 422 {"code":42210000,"message":"client_order_id must be unique"}.
    // Either way: never treat it as a rejection, adopt the original order instead.
    if (res.status === 409 || (res.status === 422 && isDuplicateBody(res.text))) {
      const original = await this.findByClientOrderId(req.clientOrderId);
      if (!original) throw new BrokerError('transient', `${res.status} duplicate but by_client_order_id lookup returned nothing`, res.status, 'duplicate_unresolved');
      return { order: original, duplicate: true };
    }
    if (res.status === 422 || res.status === 403) {
      // Business rejections (market closed for notional/fractional, invalid symbol, insufficient funds...)
      throw new BrokerError('permanent', `alpaca rejected order: ${res.text.slice(0, 300)}`, res.status, alpacaRejectCode(res.text));
    }
    return { order: mapOrder(res.json<AlpacaOrder>()), duplicate: false };
  }

  async getOrder(brokerOrderId: string): Promise<BrokerOrder> {
    const res = await this.request(`/v1/trading/accounts/${this.accountId}/orders/${brokerOrderId}`);
    return mapOrder(res.json<AlpacaOrder>());
  }

  async findByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null> {
    const res = await this.request(
      `/v1/trading/accounts/${this.accountId}/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`,
      { allowStatuses: [404] },
    );
    if (res.status === 404) return null;
    return mapOrder(res.json<AlpacaOrder>());
  }

  /** Best effort: a 422 here usually means "already filled or already canceled"; the caller re-reads the order. */
  async cancelOrder(brokerOrderId: string): Promise<void> {
    await this.request(`/v1/trading/accounts/${this.accountId}/orders/${brokerOrderId}`, { method: 'DELETE', allowStatuses: [404, 422] });
  }

  async listAccounts(): Promise<Array<{ id: string; account_number: string; status: string }>> {
    const res = await this.request('/v1/accounts');
    return res.json();
  }

  async getAccount(): Promise<unknown> {
    return (await this.request(`/v1/trading/accounts/${this.accountId}/account`)).json();
  }

  async getPositions(): Promise<unknown> {
    return (await this.request(`/v1/trading/accounts/${this.accountId}/positions`)).json();
  }
}

/** Only the message identifies a duplicate: code 42210000 is Alpaca's generic validation code. */
export function isDuplicateBody(text: string): boolean {
  return /client_order_id must be unique/i.test(text);
}

/** Best-effort machine code for the ledger: a keyword from the message, else Alpaca's numeric code. */
export function alpacaRejectCode(text: string): string {
  try {
    const j = JSON.parse(text) as { code?: number; message?: string };
    if (/market.*closed|outside.*market hours|not open/i.test(j.message ?? '')) return 'market_closed';
    if (/symbol|asset/i.test(j.message ?? '')) return 'invalid_symbol';
    if (/insufficient/i.test(j.message ?? '')) return 'insufficient_funds';
    return j.code ? `alpaca_${j.code}` : 'rejected';
  } catch {
    return 'rejected';
  }
}

const TERMINAL_RAW = new Set(['canceled', 'expired', 'done_for_day', 'stopped', 'suspended', 'rejected', 'replaced']);

/**
 * Alpaca status -> pipeline status. The one rule that matters for money: any order that
 * bought shares (filled_qty > 0) is reported as `filled`, even if the broker then closed it
 * (partial fill + cancel/expiry). Such orders carry `partial: true` and are settled for the
 * amount actually filled; they are never refunded in full.
 */
export function mapOrder(o: AlpacaOrder): BrokerOrder {
  const filledQty = o.filled_qty && Number(o.filled_qty) > 0 ? o.filled_qty : null;
  const filledNotional =
    filledQty && o.filled_avg_price ? (Number(filledQty) * Number(o.filled_avg_price)).toFixed(6) : filledQty ? (o.notional ?? null) : null;
  let status = mapStatus(o.status);
  let partial = false;
  if (filledQty && status !== 'filled' && TERMINAL_RAW.has(o.status)) {
    status = 'filled';
    partial = true;
  }
  return {
    brokerOrderId: o.id,
    clientOrderId: o.client_order_id,
    status,
    rawStatus: o.status,
    filledNotional: status === 'filled' ? filledNotional : null,
    filledQty: status === 'filled' ? filledQty : null,
    rejectReason: status === 'rejected' ? o.status : null,
    partial,
  };
}

function mapStatus(s: string): BrokerOrder['status'] {
  switch (s) {
    case 'filled':
      return 'filled';
    case 'rejected':
    case 'expired':
    case 'stopped':
    case 'suspended':
      return 'rejected';
    case 'canceled':
    case 'done_for_day':
    case 'replaced':
      return 'canceled';
    default:
      // new, accepted, pending_new, partially_filled, held, pending_cancel, accepted_for_bidding...
      return 'accepted';
  }
}
