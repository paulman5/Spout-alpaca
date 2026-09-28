import type { Connection } from '@solana/web3.js';

/**
 * RPC transport hardening, applied once on the Connection so every call site
 * (anchor Program, EventParser backfill, our own getAccountInfo) benefits.
 *
 *  1. pacing: requests are serialized and spaced by `minIntervalMs`, which is what
 *     the public devnet endpoint actually tolerates (~8 rps).
 *  2. 429 handling in both dialects: HTTP 429, and the Helius-style HTTP 200 whose
 *     body is a JSON-RPC error {code:-32429}. Exponential backoff with jitter.
 *  3. failover: on a rate limit, 5xx or network error the retry goes to the next
 *     endpoint of `endpoints` (RPC_URLS). Websocket subscriptions stay on the primary.
 *  4. confirmation by polling getSignatureStatuses instead of a websocket
 *     subscription, with a hard ceiling; on-chain failure throws (with the err JSON,
 *     so Anchor 3012 is still classifiable).
 *
 * Pair with `disableRetryOnRateLimit: true` so web3.js does not retry on top.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ResilientFetchOptions {
  endpoints: string[];
  minIntervalMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  onRetry?: (info: { attempt: number; reason: string; endpoint: string; delayMs: number }) => void;
}

function backoff(attempt: number): number {
  return Math.min(8_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 200);
}

export function createResilientFetch(opts: ResilientFetchOptions): typeof fetch {
  const { endpoints, minIntervalMs = 100, maxAttempts = 8, timeoutMs = 30_000, onRetry } = opts;
  let chain: Promise<unknown> = Promise.resolve();

  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const primary = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

    const run = async (): Promise<Response> => {
      let lastError: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Failover: rotate the endpoint for retries only when the request targets our primary RPC.
        const url = attempt > 0 && endpoints.includes(primary) ? endpoints[attempt % endpoints.length]! : primary;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetch(url, { ...init, signal: ac.signal });
        } catch (err) {
          clearTimeout(timer);
          lastError = err;
          const delayMs = backoff(attempt);
          onRetry?.({ attempt: attempt + 1, reason: `network: ${(err as Error)?.message ?? err}`, endpoint: url, delayMs });
          await sleep(delayMs);
          continue;
        }
        clearTimeout(timer);

        let reason: string | null = null;
        if (res.status === 429) reason = 'HTTP 429';
        else if (res.status >= 500) reason = `HTTP ${res.status}`;
        else if (res.ok) {
          try {
            const peek = (await res.clone().json()) as { error?: { code?: number } };
            const code = peek?.error?.code;
            if (code === -32429 || code === 429) reason = 'JSON-RPC 429';
          } catch {
            /* not JSON; nothing to inspect */
          }
        }
        if (reason === null || attempt === maxAttempts - 1) return res;

        lastError = new Error(`${reason} from ${url}`);
        const delayMs = backoff(attempt);
        onRetry?.({ attempt: attempt + 1, reason, endpoint: url, delayMs });
        await sleep(delayMs);
      }
      throw lastError instanceof Error ? lastError : new Error('RPC request failed after retries');
    };

    const result = chain.then(run, run);
    chain = result.then(
      () => sleep(minIntervalMs),
      () => sleep(minIntervalMs),
    );
    return result;
  }) as typeof fetch;
}

const POLL_INTERVAL_MS = 1_500;
const MAX_WAIT_MS = 90_000;

type ConfirmArgs = Parameters<Connection['confirmTransaction']>;

/** Replace websocket-based confirmation with status polling on this Connection instance. */
export function usePollingConfirmation(connection: Connection): Connection {
  const conn = connection as Connection & { __polling?: boolean };
  if (conn.__polling) return connection;
  conn.__polling = true;

  conn.confirmTransaction = (async (...args: ConfirmArgs) => {
    const [strategy, commitment] = args;
    const signature = typeof strategy === 'string' ? strategy : (strategy as { signature: string }).signature;
    const lastValidBlockHeight = typeof strategy === 'object' && 'lastValidBlockHeight' in strategy ? (strategy as { lastValidBlockHeight: number }).lastValidBlockHeight : null;
    const wanted = commitment ?? 'confirmed';
    const start = Date.now();
    let blockHeightChecks = 0;

    while (Date.now() - start < MAX_WAIT_MS) {
      const { context, value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: Date.now() - start > 20_000 });
      const status = value[0];
      if (status) {
        if (status.err) throw new Error(`Transaction ${signature} failed on-chain: ${JSON.stringify(status.err)}`);
        const level = status.confirmationStatus;
        if (level === 'finalized' || (wanted !== 'finalized' && level === 'confirmed') || (wanted === 'processed' && level === 'processed')) {
          return { context, value: { err: null } };
        }
      } else if (lastValidBlockHeight !== null && ++blockHeightChecks % 4 === 0) {
        // Not seen at all: has the blockhash expired? Then the tx can never land.
        const height = await connection.getBlockHeight('confirmed');
        if (height > lastValidBlockHeight) throw new Error(`Transaction ${signature} expired: block height ${height} > ${lastValidBlockHeight}`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Transaction ${signature} was not confirmed within ${MAX_WAIT_MS / 1000}s`);
  }) as Connection['confirmTransaction'];

  return connection;
}
