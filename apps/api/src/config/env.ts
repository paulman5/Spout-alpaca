import 'dotenv/config';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Also try the monorepo root .env when running from apps/api
for (const candidate of [path.resolve(process.cwd(), '../../.env'), path.resolve(process.cwd(), '.env')]) {
  if (fs.existsSync(candidate)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config({ path: candidate, override: false });
  }
}

const Role = z.enum(['api', 'listener', 'worker', 'reconciler', 'mock-broker']);
/** "1" / "true" -> true, anything else -> false (z.coerce.boolean would turn "false" into true). */
const bool = (def: boolean) => z.preprocess((v) => (v === undefined || v === '' ? def : v === true || v === 'true' || v === '1'), z.boolean());

const schema = z
  .object({
    ROLE: Role.default('api'),
    PORT: z.coerce.number().default(4000),
    /** Liveness endpoint for headless roles (listener/worker/reconciler); 0 disables. */
    HEALTH_PORT: z.coerce.number().default(0),
    LOG_LEVEL: z.string().default('info'),

    DATABASE_URL: z.string().min(1),

    RPC_URL: z.string().url().default('https://api.devnet.solana.com'),
    WS_URL: z.string().optional(),
    /** Extra HTTP endpoints for failover on 429/5xx (comma separated). Websocket stays on RPC_URL. */
    RPC_URLS: z.string().default(''),
    /** Minimum gap between two RPC requests per process; public devnet tolerates ~8 rps. */
    RPC_MIN_INTERVAL_MS: z.coerce.number().default(100),
    PROGRAM_ID: z.string().default('DB2h5equ9Qp2qaaeKyL9sL6RD8LAhZzjiSUYgnaW3aeF'),
    KEYPAIR_PATH: z.string().default('./keys/devnet-keypair.json'),
    /** Optional raw JSON secret key (for hosted envs where there is no file). */
    KEYPAIR_JSON: z.string().optional(),

    BROKER: z.enum(['mock', 'alpaca']).default('mock'),
    MOCK_BROKER_URL: z.string().default('http://localhost:4010'),
    MOCK_BROKER_PORT: z.coerce.number().default(4010),
    /** Initial fault injection for the mock broker (also settable at runtime via POST /admin/faults). */
    MOCK_FAULT_MODE: z.enum(['none', 'http500', 'slow', 'market_closed', 'flaky']).default('none'),
    MOCK_FAIL_RATE: z.coerce.number().min(0).max(1).default(0.5),
    MOCK_SLOW_MIN_MS: z.coerce.number().default(2000),
    MOCK_SLOW_MAX_MS: z.coerce.number().default(10000),
    MOCK_FILL_DELAY_MS: z.coerce.number().default(3000),
    /** Seed for the mock's random failures, so a flaky run is reproducible. */
    MOCK_SEED: z.coerce.number().default(42),

    ALPACA_BASE_URL: z.string().default('https://broker-api.sandbox.alpaca.markets'),
    ALPACA_AUTH_URL: z.string().default('https://authx.sandbox.alpaca.markets/v1/oauth2/token'),
    ALPACA_CLIENT_ID: z.string().optional(),
    ALPACA_CLIENT_SECRET: z.string().optional(),
    ALPACA_ACCOUNT_ID: z.string().optional(),
    /** Explicit escape hatch: the pipeline refuses any non-sandbox Alpaca host unless this is set. */
    ALPACA_ALLOW_LIVE: bool(false),

    WORKER_ID: z.string().optional(),
    WORKER_POLL_MS: z.coerce.number().default(1000),
    WORKER_BATCH: z.coerce.number().default(5),
    LEASE_SECONDS: z.coerce.number().default(60),
    BROKER_POLL_MS: z.coerce.number().default(2000),
    RETRY_MAX_ATTEMPTS: z.coerce.number().default(10),
    RETRY_BASE_MS: z.coerce.number().default(1000),
    RETRY_MAX_MS: z.coerce.number().default(60000),
    RECONCILE_INTERVAL_MS: z.coerce.number().default(60000),
    RECONCILE_MIN_AGE_MS: z.coerce.number().default(120000),
    RECONCILE_ONCE: bool(false),
    LISTENER_BACKFILL_MS: z.coerce.number().default(60000),
    /** signatures fetched on the very first start (no cursor yet) */
    LISTENER_INITIAL_LIMIT: z.coerce.number().default(10),
    LISTENER_BACKFILL_DELAY_MS: z.coerce.number().default(500),
    /** Workers ignore the Postgres kill-switch (used only by the chaos scenarios). */
    WORKER_IGNORE_PAUSE: bool(false),

    // ---- Safety rails -------------------------------------------------------
    /** Orders above this notional (USDC, whole units) are never traded automatically: needs_human. 0 disables. */
    MAX_ORDER_USDC: z.coerce.number().default(10000),
    /** Circuit breaker: this many critical alerts within the window pause the workers. 0 disables. */
    CIRCUIT_BREAKER_ALERTS: z.coerce.number().default(3),
    CIRCUIT_BREAKER_WINDOW_MS: z.coerce.number().default(10 * 60_000),
    /** When set, ops and chaos endpoints require `x-admin-token` (or Bearer). Empty = open (local dev). */
    ADMIN_TOKEN: z.string().default(''),

    // ---- Chaos hooks (scenarios B and D) ------------------------------------
    WORKER_CRASH_POINT: z.enum(['', 'after_broker_accept', 'after_settle_sign']).default(''),
    CHAIN_FAULT: z.enum(['', 'drop_confirmation']).default(''),
  })
  .refine((e) => e.ALPACA_ALLOW_LIVE || (/sandbox/.test(e.ALPACA_BASE_URL) && /sandbox/.test(e.ALPACA_AUTH_URL)), {
    message: 'ALPACA_BASE_URL / ALPACA_AUTH_URL must point at the sandbox (set ALPACA_ALLOW_LIVE=1 to override)',
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment:', parsed.error.flatten());
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export const ENV = Symbol('ENV');
