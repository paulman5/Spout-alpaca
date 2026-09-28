/** Anchor error 3012: the PDA is closed -> the order was already fulfilled or refunded. */
export const ANCHOR_ACCOUNT_NOT_INITIALIZED = 3012;

export type ChainErrorKind = 'already_settled' | 'transient' | 'permanent';

export class ChainError extends Error {
  constructor(
    public readonly kind: ChainErrorKind,
    message: string,
    public readonly signature?: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ChainError';
  }
}

export function classifyChainError(err: unknown, signature?: string): ChainError {
  if (err instanceof ChainError) return err;
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
  const text = `${msg} ${safeLogs(err)}`;
  // 0xbc4 == 3012
  if (/AccountNotInitialized|custom program error: 0xbc4|Error Number: 3012|\b3012\b/.test(text)) {
    return new ChainError('already_settled', 'PDA already closed (Anchor 3012 AccountNotInitialized)', signature, err);
  }
  if (/WrongOrderSide|TickerTooLong|ZeroAmount|ConstraintHasOne|ConstraintSeeds|0x7d1|0x7d6|0x1770|0x1771|0x1772/.test(text)) {
    return new ChainError('permanent', `Program rejected instruction: ${msg}`, signature, err);
  }
  // Blockhash expiry, RPC hiccups, confirmation timeouts, rate limits: retry.
  return new ChainError('transient', msg, signature, err);
}

function safeLogs(err: unknown): string {
  const logs = (err as { logs?: unknown })?.logs;
  return Array.isArray(logs) ? logs.join(' ') : '';
}
