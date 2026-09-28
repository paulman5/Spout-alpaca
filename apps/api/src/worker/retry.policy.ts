import { BrokerError } from '../broker/broker.errors';
import { ChainError } from '../chain/chain.errors';

export interface RetryConfig {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
}

export type FailureKind = 'transient' | 'permanent' | 'already_settled';

/** Errors from the two edges are already classified; anything else (DB blip, bug) is retried. */
export function classifyFailure(err: unknown): FailureKind {
  if (err instanceof BrokerError) return err.kind; // decided at the broker edge: 5xx/429/401/timeouts transient, business rejections permanent
  if (err instanceof ChainError) return err.kind; // decided at the chain edge: 3012 already_settled, program errors permanent, RPC trouble transient
  return 'transient'; // unknown (database blip, bug): retrying is safer than refunding
}

/** Exponential backoff with full jitter: 1s, 2s, 4s ... capped at maxMs. attempt is 1-based. */
export function backoffMs(attempt: number, cfg: RetryConfig, rand: () => number = Math.random): number {
  const exp = Math.min(cfg.maxMs, cfg.baseMs * 2 ** Math.max(0, attempt - 1)); // 1 s, 2 s, 4 s ... capped at 60 s
  const jitter = 0.8 + rand() * 0.4; // ±20 %, so several workers never retry in lockstep
  return Math.round(Math.min(cfg.maxMs, exp * jitter));
}

export function isExhausted(attempts: number, cfg: RetryConfig): boolean {
  return attempts >= cfg.maxAttempts;
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 500);
  return String(err).slice(0, 500);
}
