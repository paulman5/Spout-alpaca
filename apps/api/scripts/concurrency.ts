/**
 * Concurrency check: place N orders back-to-back while >= 2 workers run, then assert
 * that no order was processed twice (one broker order per client_order_id, one
 * settlement transition per order) and print which worker handled each one.
 *   pnpm exec tsx scripts/concurrency.ts [n]
 */
import type { OrderEventView, OrderView } from '@spout/shared';
import { api, assert, log, mock, sleep } from './_ctx';
import { placeBuyOrder } from './place-order';

(async () => {
  const n = Number(process.argv[2] ?? 6);
  const placed = [];
  for (let i = 0; i < n; i++) {
    placed.push(await placeBuyOrder('AAPL', 5 + i));
    await sleep(400);
  }
  log(`placed ${n} orders`);
  const deadline = Date.now() + 240_000;
  const results: OrderView[] = [];
  for (const p of placed) {
    let o: OrderView | null = null;
    while (Date.now() < deadline) {
      o = await api<OrderView>(`/orders/${p.user}/${p.orderId}`).catch(() => null);
      if (o && ['settled', 'refunded', 'needs_human'].includes(o.status)) break;
      await sleep(1000);
    }
    assert(o?.status === 'settled', `order ${p.orderId} settled`);
    results.push(o!);
  }
  const workers = new Set<string>();
  for (const o of results) {
    const evs = await api<OrderEventView[]>(`/orders/${o.userPubkey}/${o.orderId}/events`);
    const actors = new Set(evs.filter((e) => e.actor.startsWith('worker:')).map((e) => e.actor));
    actors.forEach((a) => workers.add(a));
    // Steps of one order may be handled by different workers (a lease is per step, not per order);
    // what must never happen is the same step twice.
    const placements = evs.filter((e) => /^broker_(accepted|duplicate_adopted|recovered)/.test(e.reason)).length;
    assert(placements === 1, `order ${o.orderId}: one broker placement (workers: ${[...actors].join(',')})`);
    assert(evs.filter((e) => e.toStatus === 'settled' && e.fromStatus !== 'settled').length === 1, `order ${o.orderId}: one settlement transition`);
    const cnt = await mock<{ count: number }>(`/admin/count?client_order_id=${encodeURIComponent(o.clientOrderId)}`);
    assert(cnt.count === 1, `order ${o.orderId}: one broker order`);
  }
  assert(workers.size >= 2, `work was spread across ${workers.size} workers: ${[...workers].join(', ')}`);
  log('concurrency check passed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
