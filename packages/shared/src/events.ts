/** Decoded Anchor events of the orders-lite program (names match the IDL). */
export interface BuyOrderCreated {
  user: string;
  orderId: string; // u64 as decimal string
  ticker: string;
  usdcAmount: string; // u64, 6 dp
}
export interface SellOrderCreated {
  user: string;
  orderId: string;
  ticker: string;
  tokenAmount: string;
}
export interface OrderClosed {
  user: string;
  orderId: string;
  actualUsdc?: string;
}
export type ProgramEventName =
  | 'BuyOrderCreated'
  | 'SellOrderCreated'
  | 'BuyOrderFulfilled'
  | 'SellOrderFulfilled'
  | 'BuyOrderRefunded'
  | 'SellOrderRefunded';

/** Wire shape of an order as returned by the API and consumed by the web app. */
export interface OrderView {
  userPubkey: string;
  orderId: string;
  side: 'buy' | 'sell';
  ticker: string;
  amount: string;
  status: string;
  clientOrderId: string;
  brokerOrderId: string | null;
  brokerStatus: string | null;
  filledNotional: string | null;
  filledQty: string | null;
  settleSignature: string | null;
  createdSignature: string;
  attempts: number;
  nextAttemptAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEventView {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string;
  details: Record<string, unknown> | null;
  actor: string;
  createdAt: string;
}
