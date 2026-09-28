/**
 * Order lifecycle. Every transition is written to `order_events` in the same
 * transaction as the `orders.status` update, so the ledger is the source of truth.
 *
 *  recorded ─▶ broker_placing ─▶ broker_placed ─▶ filled ─▶ settling ─▶ settled
 *                   │ permanent rejection ────────────────▶ refunding ─▶ refunded
 *                   │ retries exhausted, broker has no trade ─▶ refunding
 *                   │ retries exhausted, broker FILLED ───────▶ needs_human
 *  recorded ─▶ settled | refunded   (PDA already closed before we ever traded)
 *  recorded ─▶ needs_human          (order above the notional cap: manual approval)
 */
export const ORDER_STATUSES = [
  'recorded',
  'broker_placing',
  'broker_placed',
  'filled',
  'settling',
  'settled',
  'refunding',
  'refunded',
  'needs_human',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['settled', 'refunded', 'needs_human'];
export const WORKABLE_STATUSES: readonly OrderStatus[] = [
  'recorded',
  'broker_placing',
  'broker_placed',
  'filled',
  'settling',
  'refunding',
];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Allowed transitions; anything else is a bug and is rejected by LedgerService. */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  recorded: ['broker_placing', 'refunding', 'settled', 'refunded', 'needs_human'],
  broker_placing: ['broker_placed', 'filled', 'refunding', 'needs_human'],
  broker_placed: ['filled', 'refunding', 'needs_human'],
  filled: ['settling', 'settled', 'needs_human'],
  settling: ['settled', 'needs_human'],
  refunding: ['refunded', 'needs_human'],
  settled: [],
  refunded: [],
  needs_human: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type OrderSide = 'buy' | 'sell';

export type BrokerOrderStatus = 'accepted' | 'filled' | 'rejected' | 'canceled';
