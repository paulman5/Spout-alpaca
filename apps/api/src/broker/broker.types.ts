import type { BrokerOrderStatus } from '@spout/shared';

export interface PlaceOrderRequest {
  /** Deterministic, derived from (user, order_id). The broker rejects duplicates with 409. */
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  /** Dollar notional as a decimal string (e.g. "2500.00"). */
  notional: string;
}

export interface BrokerOrder {
  brokerOrderId: string;
  clientOrderId: string;
  status: BrokerOrderStatus;
  /** Raw broker status string, kept for the ledger. */
  rawStatus: string;
  filledNotional: string | null;
  filledQty: string | null;
  rejectReason: string | null;
  /** The broker closed the order (canceled/expired/done_for_day) after filling only part of it. */
  partial?: boolean;
}

export interface PlaceOrderResult {
  order: BrokerOrder;
  /** true when the broker answered 409 and we adopted the original order. */
  duplicate: boolean;
}

/**
 * The single seam between the settlement worker and the outside world.
 * Implemented by AlpacaBrokerClient (real sandbox) and MockBrokerClient.
 */
export interface BrokerClient {
  readonly name: string;
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  getOrder(brokerOrderId: string): Promise<BrokerOrder>;
  /** Crash-recovery lookup. null when the broker has never seen this client_order_id. */
  findByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null>;
  cancelOrder(brokerOrderId: string): Promise<void>;
}

export const BROKER_CLIENT = Symbol('BROKER_CLIENT');
