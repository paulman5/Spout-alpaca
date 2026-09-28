export type BrokerErrorKind = 'transient' | 'permanent';

/**
 * Every failure from a broker call is classified at the edge, so the worker's
 * retry policy only ever sees "retry this" or "never retry this".
 */
export class BrokerError extends Error {
  constructor(
    public readonly kind: BrokerErrorKind,
    message: string,
    public readonly httpStatus?: number,
    public readonly code?: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BrokerError';
  }
}

const PERMANENT_PATTERNS = /market.?(is.?)?closed|not.?tradable|invalid.?symbol|asset.?not.?found|insufficient|forbidden|unauthori[sz]ed|fractional/i;

export function classifyHttpFailure(status: number, body: string): BrokerError {
  if (status === 429) return new BrokerError('transient', `rate limited (${status})`, status, 'rate_limited');
  if (status >= 500) return new BrokerError('transient', `broker ${status}: ${body.slice(0, 200)}`, status, 'server_error');
  if (status === 408) return new BrokerError('transient', `broker timeout (${status})`, status, 'timeout');
  // An expired/revoked token is an infrastructure problem, not a market decision: retry, never refund.
  if (status === 401) return new BrokerError('transient', `broker auth failed (${status})`, status, 'auth');
  const code = PERMANENT_PATTERNS.test(body) ? 'rejected' : 'client_error';
  return new BrokerError('permanent', `broker ${status}: ${body.slice(0, 200)}`, status, code);
}

export function classifyNetworkFailure(err: unknown): BrokerError {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  // fetch throws TypeError on connection refused / DNS / reset; AbortError on timeout.
  return new BrokerError('transient', `network: ${msg}`, undefined, 'network', err);
}

export function isTransient(err: unknown): boolean {
  return err instanceof BrokerError ? err.kind === 'transient' : false;
}
