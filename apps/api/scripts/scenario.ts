/**
 * Runnable demonstrations of the README scenarios A–G.
 *   pnpm scenario a        (idempotent replay)
 *   pnpm scenario b        (crash between broker-accept and DB write)
 *   pnpm scenario c        (broker 500s for 30 s -> backoff -> completes)
 *   pnpm scenario d        (settlement confirmation lost -> retry hits 3012 -> settled)
 *   pnpm scenario e        (market closed -> refund_buy_order)
 *   pnpm scenario f        (reconciliation repairs drift)
 *   pnpm scenario g        (real Alpaca sandbox end-to-end; workers must run with BROKER=alpaca)
 *
 * Requirements: the stack is up (docker compose up, or the processes started by hand),
 * API on API_URL (default http://localhost:4000), mock broker on MOCK_BROKER_URL.
 * Scenarios B and D spawn their own purposely-broken worker from this repo.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import type { OrderEventView, OrderView } from '@spout/shared';
import { api, assert, log, mock, sleep } from './_ctx';
import { placeBuyOrder } from './place-order';

const TERMINAL = ['settled', 'refunded', 'needs_human'];

async function getOrder(user: string, orderId: string): Promise<OrderView | null> {
  return api<OrderView>(`/orders/${user}/${orderId}`).catch(() => null);
}
async function events(user: string, orderId: string): Promise<OrderEventView[]> {
  return api<OrderEventView[]>(`/orders/${user}/${orderId}/events`);
}
async function waitFor(user: string, orderId: string, pred: (o: OrderView) => boolean, label: string, timeoutMs = 240_000): Promise<OrderView> {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const o = await getOrder(user, orderId);
    if (o && o.status !== last) {
      last = o.status;
      log(`  status -> ${o.status}${o.attempts ? ` (attempts=${o.attempts})` : ''}`);
    }
    if (o && pred(o)) return o;
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${label} on ${user}/${orderId}`);
}
const waitTerminal = (u: string, id: string, t?: number) => waitFor(u, id, (o) => TERMINAL.includes(o.status), 'terminal state', t);
async function mockCount(clientOrderId: string): Promise<number> {
  return (await mock<{ count: number }>(`/admin/count?client_order_id=${encodeURIComponent(clientOrderId)}`)).count;
}
async function resetFaults() {
  await mock('/admin/faults', { method: 'POST', body: JSON.stringify({ mode: 'none', fillDelayMs: 3000 }) });
}
const pauseWorkers = () => api('/workers/pause', { method: 'POST' });
const resumeWorkers = () => api('/workers/resume', { method: 'POST' });
async function requireMockBroker() {
  const cfg = await api<{ broker: string }>('/config');
  assert(cfg.broker === 'mock', `workers run against the mock broker (BROKER=${cfg.broker})`);
}
function printLedger(evs: OrderEventView[]) {
  for (const e of evs) log(`    ${e.createdAt.slice(11, 23)} ${(e.fromStatus ?? '-').padEnd(15)} -> ${e.toStatus.padEnd(15)} ${e.reason.padEnd(34)} ${e.actor}`);
}

/** Spawn an extra worker from source with custom env (B and D). */
function spawnWorker(name: string, env: Record<string, string>): ChildProcess {
  const cwd = path.resolve(__dirname, '..');
  // ts-node (not tsx): Nest needs emitDecoratorMetadata, which esbuild-based runners drop.
  const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/main.ts'], {
    cwd,
    env: { ...process.env, ROLE: 'worker', WORKER_ID: name, WORKER_IGNORE_PAUSE: '1', LOG_PRETTY: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `[${name}]`;
  child.stdout?.on('data', (d: Buffer) => d.toString().split('\n').filter((l) => /transition|WORKER_CRASH|CHAIN_FAULT|attempt|settlement|ALERT|->/.test(l)).forEach((l) => log(`${tag} ${l.trim().slice(0, 160)}`)));
  child.stderr?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach((l) => log(`${tag}! ${l.trim().slice(0, 160)}`)));
  return child;
}
function killTree(child: ChildProcess) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill('SIGKILL');
}

// ---------------------------------------------------------------------------

async function scenarioA() {
  log('A. Same event replayed 3x -> exactly one broker order, one settlement');
  await requireMockBroker();
  await resetFaults();
  const o = await placeBuyOrder('AAPL', 10);
  log(`  placed ${o.user}/${o.orderId} sig=${o.signature}`);
  const done = await waitTerminal(o.user, o.orderId);
  assert(done.status === 'settled', `order settled (settle sig ${done.settleSignature})`);

  for (let i = 1; i <= 3; i++) {
    const r = await api<{ newRawEvents: number; duplicateRawEvents: number; newOrders: number }>('/replay', { method: 'POST', body: JSON.stringify({ signature: o.signature }) });
    log(`  replay #${i}: newRaw=${r.newRawEvents} dupRaw=${r.duplicateRawEvents} newOrders=${r.newOrders}`);
    assert(r.newOrders === 0 && r.newRawEvents === 0, `replay #${i} created nothing`);
  }
  await sleep(2500);
  const after = await getOrder(o.user, o.orderId);
  assert(after?.status === 'settled' && after.settleSignature === done.settleSignature, 'order unchanged after replays (same settlement signature)');
  assert((await mockCount(done.clientOrderId)) === 1, 'broker holds exactly one order for this client_order_id');
  const evs = await events(o.user, o.orderId);
  assert(evs.filter((e) => e.reason === 'duplicate_event_ignored').length === 3, 'ledger shows 3 ignored duplicates');
  assert(evs.filter((e) => e.toStatus === 'settled' && e.fromStatus !== 'settled').length === 1, 'exactly one settlement transition');
  printLedger(evs);
}

async function scenarioB() {
  log('B. Worker killed after broker-accept, before DB write -> restart -> no duplicate, completes');
  await requireMockBroker();
  await resetFaults();
  await mock('/admin/faults', { method: 'POST', body: JSON.stringify({ mode: 'none', fillDelayMs: 8000 }) });
  await pauseWorkers();
  log('  regular workers paused (kill-switch)');
  const o = await placeBuyOrder('AAPL', 12);
  log(`  placed ${o.user}/${o.orderId}`);
  const rec = await waitFor(o.user, o.orderId, () => true, 'order recorded', 60_000);
  log('  spawning crash-worker with WORKER_CRASH_POINT=after_broker_accept');
  const crash = spawnWorker('crash-worker', { WORKER_CRASH_POINT: 'after_broker_accept' });
  const exit = await new Promise<number | null>((r) => crash.on('exit', (code) => r(code)));
  log(`  crash-worker exited with code ${exit}`);

  const mid = await getOrder(o.user, o.orderId);
  assert(mid?.status === 'broker_placing' && !mid.brokerOrderId, `DB still says broker_placing with no broker_order_id (intent only)`);
  assert((await mockCount(rec.clientOrderId)) === 1, 'broker already holds 1 order (accepted before the crash)');

  log('  resuming the regular workers (= the restart)');
  await resumeWorkers();
  const done = await waitTerminal(o.user, o.orderId);
  assert(done.status === 'settled', 'order completed after restart');
  assert((await mockCount(rec.clientOrderId)) === 1, 'still exactly one broker order (no duplicate trade)');
  const evs = await events(o.user, o.orderId);
  assert(evs.some((e) => e.reason === 'broker_recovery_found'), 'ledger shows the by_client_order_id recovery lookup');
  printLedger(evs);
  await resetFaults();
}

async function scenarioC() {
  log('C. Broker returns 500s for 30 s -> retries with backoff -> completes once outage ends');
  await requireMockBroker();
  await resetFaults();
  await mock('/admin/faults', { method: 'POST', body: JSON.stringify({ mode: 'http500', durationMs: 30_000 }) });
  log('  mock broker: http500 for 30 s');
  const o = await placeBuyOrder('AAPL', 15);
  log(`  placed ${o.user}/${o.orderId}`);
  const done = await waitTerminal(o.user, o.orderId);
  assert(done.status === 'settled', 'order settled after the outage');
  const evs = await events(o.user, o.orderId);
  const retries = evs.filter((e) => e.reason === 'retry_scheduled');
  const delays = retries.map((e) => Number((e.details as { delayMs: number }).delayMs));
  log(`  retry delays (ms): ${delays.join(', ')}`);
  assert(retries.length >= 3, `at least 3 retries happened (${retries.length})`);
  assert(delays.every((d, i) => i === 0 || d > delays[i - 1]! * 1.2), 'delays grow exponentially');
  assert(!evs.some((e) => e.toStatus === 'refunding' || e.toStatus === 'needs_human'), 'no refund, no dead-letter');
  assert((await mockCount(done.clientOrderId)) === 1, 'exactly one broker order');
  printLedger(evs);
}

async function scenarioD() {
  log('D. Settlement tx sent, confirmation lost -> retry hits AccountNotInitialized (3012) -> settled');
  await requireMockBroker();
  await resetFaults();
  await pauseWorkers();
  log('  regular workers paused (kill-switch)');
  const o = await placeBuyOrder('AAPL', 18);
  log(`  placed ${o.user}/${o.orderId}`);
  await waitFor(o.user, o.orderId, () => true, 'order recorded', 60_000);
  log('  spawning chaos-worker with CHAIN_FAULT=drop_confirmation');
  const chaos = spawnWorker('chaos-worker', { CHAIN_FAULT: 'drop_confirmation', RETRY_BASE_MS: '2000' });
  try {
    const done = await waitTerminal(o.user, o.orderId);
    assert(done.status === 'settled', 'order settled');
    const evs = await events(o.user, o.orderId);
    const signed = evs.filter((e) => e.reason === 'fulfill_tx_signed');
    assert(evs.some((e) => e.reason === 'retry_scheduled' && /timeout/.test(String((e.details as { error?: string }).error))), 'first attempt lost its confirmation and was scheduled for retry');
    assert(evs.some((e) => e.reason === 'already_settled_3012'), 'retry got Anchor 3012 and recorded it as settled');
    assert(signed.length >= 2, `${signed.length} transactions signed, only the first landed`);
    assert(evs.filter((e) => e.toStatus === 'settled' && e.fromStatus !== 'settled').length === 1, 'exactly one settled transition, no double-send loop');
    printLedger(evs);
  } finally {
    killTree(chaos);
    await resumeWorkers().catch(() => undefined);
  }
}

async function scenarioE() {
  log('E. Market closed rejection -> refund_buy_order on-chain -> refunded (no retry loop)');
  await requireMockBroker();
  await resetFaults();
  await mock('/admin/faults', { method: 'POST', body: JSON.stringify({ mode: 'market_closed' }) });
  log('  mock broker: market_closed');
  const o = await placeBuyOrder('AAPL', 20);
  log(`  placed ${o.user}/${o.orderId}`);
  try {
    const done = await waitTerminal(o.user, o.orderId);
    assert(done.status === 'refunded', `terminal state is refunded (refund sig ${done.settleSignature})`);
    const evs = await events(o.user, o.orderId);
    const rej = evs.find((e) => e.reason === 'broker_rejected');
    assert(rej && (rej.details as { code?: string }).code === 'market_closed', 'ledger records the permanent rejection with code market_closed');
    assert(!evs.some((e) => e.reason === 'retry_scheduled'), 'no retry was scheduled for a permanent rejection');
    assert((await mockCount(done.clientOrderId)) === 0, 'broker holds no order');
    printLedger(evs);
  } finally {
    await resetFaults();
  }
}

async function scenarioF() {
  log('F. Reconciliation repairs drift');
  await requireMockBroker();
  await resetFaults();

  log('  F1: broker filled but DB stuck in broker_placed (poller "missed" it)');
  await mock('/admin/faults', { method: 'POST', body: JSON.stringify({ mode: 'none', fillDelayMs: 600_000 }) });
  const a = await placeBuyOrder('AAPL', 21);
  const placed = await waitFor(a.user, a.orderId, (o) => o.status === 'broker_placed', 'broker_placed', 90_000);
  // freeze the poller for this order, then fill at the broker behind its back
  await api(`/orders/${a.user}/${a.orderId}/drift`, { method: 'POST', body: JSON.stringify({ nextAttemptInMs: 3_600_000 }) });
  await api(`/mock/orders/${placed.brokerOrderId}/fill`, { method: 'POST' });
  log('  broker order force-filled; DB poller frozen for 1h');
  await sleep(1500);
  assert((await getOrder(a.user, a.orderId))?.status === 'broker_placed', 'DB still says broker_placed');
  const r1 = await api<{ repaired: Array<{ order: string; from: string; to: string; reason: string }> }>('/reconcile', { method: 'POST', body: JSON.stringify({ minAgeMs: 0 }) });
  const fix1 = r1.repaired.find((r) => r.order === `${a.user}/${a.orderId}`);
  assert(fix1?.to === 'filled' && fix1.reason === 'broker_filled', `reconciler moved it to filled (${JSON.stringify(fix1)})`);
  const doneA = await waitTerminal(a.user, a.orderId);
  assert(doneA.status === 'settled', 'worker then settled it on-chain');

  log('  F2: DB thinks settling, but the PDA is already gone on-chain');
  await mock('/admin/faults', { method: 'POST', body: JSON.stringify({ mode: 'none', fillDelayMs: 2000 }) });
  const b = await placeBuyOrder('AAPL', 22);
  const doneB = await waitTerminal(b.user, b.orderId);
  assert(doneB.status === 'settled', 'order settled normally first');
  await api(`/orders/${b.user}/${b.orderId}/drift`, { method: 'POST', body: JSON.stringify({ status: 'settling', settleSignature: null, nextAttemptInMs: 3_600_000 }) });
  log('  drift injected: status=settling, settle_signature=null');
  const r2 = await api<{ repaired: Array<{ order: string; from: string; to: string; reason: string }> }>('/reconcile', { method: 'POST', body: JSON.stringify({ minAgeMs: 0 }) });
  const fix2 = r2.repaired.find((r) => r.order === `${b.user}/${b.orderId}`);
  assert(fix2?.to === 'settled' && fix2.reason === 'pda_closed', `reconciler saw the closed PDA and repaired to settled (${JSON.stringify(fix2)})`);
  printLedger(await events(b.user, b.orderId));
  await resetFaults();
}

async function scenarioG() {
  log('G. Real Alpaca sandbox end-to-end: devnet BuyOrderCreated -> sandbox order -> fill -> fulfill_buy_order');
  const cfg = await api<{ broker: string }>('/config');
  assert(cfg.broker === 'alpaca', `workers run against Alpaca (BROKER=${cfg.broker}); set BROKER=alpaca in .env and restart the workers`);
  const [, , , ticker = 'AAPL', amount = '5'] = process.argv;
  const o = await placeBuyOrder(ticker, Number(amount));
  log(`  placed ${o.user}/${o.orderId} sig=${o.signature}`);
  log(`  https://explorer.solana.com/tx/${o.signature}?cluster=devnet`);
  const done = await waitTerminal(o.user, o.orderId, 15 * 60_000);
  assert(done.status === 'settled', `settled on devnet: https://explorer.solana.com/tx/${done.settleSignature}?cluster=devnet`);
  assert(!!done.brokerOrderId, `alpaca order ${done.brokerOrderId} filled qty=${done.filledQty} notional=${done.filledNotional}`);
  printLedger(await events(o.user, o.orderId));
}

const scenarios: Record<string, () => Promise<void>> = { a: scenarioA, b: scenarioB, c: scenarioC, d: scenarioD, e: scenarioE, f: scenarioF, g: scenarioG };
const which = (process.argv[2] ?? '').toLowerCase();
const fn = scenarios[which];
if (!fn) {
  // eslint-disable-next-line no-console
  console.error(`usage: pnpm scenario <a|b|c|d|e|f|g>`);
  process.exit(2);
}
fn()
  .then(() => {
    log(`scenario ${which.toUpperCase()} passed`);
    process.exit(0);
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
