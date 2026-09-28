/**
 * Deterministic broker client_order_id. It is derived from the business key
 * (user, order_id) BEFORE any broker call, so a replayed event, a crashed
 * worker, or a second worker instance all produce the same id and the broker's
 * 409-on-duplicate becomes the exactly-once backstop.
 * Alpaca limit: 128 chars. base58 pubkey (<=44) + u64 (<=20) + prefix fits.
 */
export function clientOrderId(userPubkey: string, orderId: bigint | string): string {
  return `spout-${userPubkey}-${orderId.toString()}`;
}

export function parseClientOrderId(id: string): { userPubkey: string; orderId: string } | null {
  const m = /^spout-([1-9A-HJ-NP-Za-km-z]{32,44})-(\d{1,20})$/.exec(id);
  if (!m) return null;
  return { userPubkey: m[1]!, orderId: m[2]! };
}
