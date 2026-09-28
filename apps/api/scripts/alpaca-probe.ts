/**
 * Smoke-test the real Alpaca sandbox client outside the pipeline:
 * token, by_client_order_id 404, place a tiny notional order, poll it, cancel it.
 *   pnpm exec tsx scripts/alpaca-probe.ts [symbol] [notional]
 */
import { loadEnv } from '../src/config/env';
import { AlpacaBrokerClient } from '../src/broker/alpaca/alpaca-broker.client';
import { log, sleep } from './_ctx';

(async () => {
  const env = loadEnv();
  const client = new AlpacaBrokerClient({ ...env, BROKER: 'alpaca' });
  const [symbol = 'AAPL', notional = '1'] = process.argv.slice(2);
  const clientOrderId = `spout-probe-${Date.now()}`;

  log(`lookup unknown client_order_id -> ${JSON.stringify(await client.findByClientOrderId(clientOrderId))}`);
  try {
    const placed = await client.placeOrder({ clientOrderId, symbol, side: 'buy', notional });
    log(`placed: ${JSON.stringify(placed)}`);
    const again = await client.placeOrder({ clientOrderId, symbol, side: 'buy', notional });
    log(`placed again (expect duplicate=true): duplicate=${again.duplicate} id=${again.order.brokerOrderId}`);
    for (let i = 0; i < 5; i++) {
      await sleep(2000);
      const o = await client.getOrder(placed.order.brokerOrderId);
      log(`poll: status=${o.status} raw=${o.rawStatus} filledQty=${o.filledQty} filledNotional=${o.filledNotional}`);
      if (o.status !== 'accepted') break;
    }
    const byId = await client.findByClientOrderId(clientOrderId);
    log(`by_client_order_id -> ${byId?.brokerOrderId} ${byId?.rawStatus}`);
    if (byId?.status === 'accepted') {
      await client.cancelOrder(placed.order.brokerOrderId);
      log(`cancel requested; now: ${(await client.getOrder(placed.order.brokerOrderId)).rawStatus}`);
    }
  } catch (e) {
    log(`placeOrder error: ${String(e)} ${JSON.stringify(e)}`);
  }
  log(`account: ${JSON.stringify(await client.getAccount()).slice(0, 300)}`);
})().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
