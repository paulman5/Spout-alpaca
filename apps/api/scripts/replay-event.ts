/**
 * Re-feed an on-chain transaction through the ingest path (scenario A).
 *   pnpm replay-event <signature> [times]
 * Goes through the API so it works against the docker-compose stack.
 */
import { api, log } from './_ctx';

const [signature, times = '1'] = process.argv.slice(2);
if (!signature) {
  // eslint-disable-next-line no-console
  console.error('usage: pnpm replay-event <signature> [times]');
  process.exit(2);
}

(async () => {
  for (let i = 0; i < Number(times); i++) {
    const r = await api('/replay', { method: 'POST', body: JSON.stringify({ signature }) });
    log(`replay #${i + 1}: ${JSON.stringify(r)}`);
  }
})().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
