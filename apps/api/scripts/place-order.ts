/**
 * Place a buy order on the devnet orders-lite program with the worker's keypair.
 *   pnpm place-order AAPL 25          -> buy 25 USDC of AAPL
 *   pnpm place-order AAPL 25 --wait   -> then wait for the pipeline to reach a terminal state
 */
import 'reflect-metadata';
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { ORDERS_LITE_IDL, pendingOrderPda } from '@spout/shared';
import { loadEnv } from '../src/config/env';
import { loadKeypair } from '../src/chain/wallet';
import { api, log, sleep } from './_ctx';

export async function placeBuyOrder(ticker: string, usdc: number, orderId?: bigint) {
  const env = loadEnv();
  const keypair = loadKeypair(env);
  const connection = new Connection(env.RPC_URL, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: 'confirmed' });
  const program = new Program(ORDERS_LITE_IDL as unknown as Idl, provider);
  const id = new BN((orderId ?? BigInt(Date.now())).toString());
  const units = new BN(Math.round(usdc * 1e6));
  const pda = pendingOrderPda(keypair.publicKey, id.toString(), new PublicKey(env.PROGRAM_ID));
  const signature = await program.methods['placeBuyOrder']!(id, ticker, units).accounts({ user: keypair.publicKey }).rpc();
  return { user: keypair.publicKey.toBase58(), orderId: id.toString(), pda: pda.toBase58(), signature, ticker, usdc };
}

export async function waitForTerminal(user: string, orderId: string, timeoutMs = 180_000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const o = await api<{ status: string; settleSignature: string | null } | null>(`/orders/${user}/${orderId}`).catch(() => null);
    if (o && o.status !== last) {
      last = o.status;
      log(`status: ${o.status}`);
    }
    if (o && ['settled', 'refunded', 'needs_human'].includes(o.status)) return o;
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${user}/${orderId}`);
}

if (require.main === module) {
  const [ticker = 'AAPL', amount = '25', ...flags] = process.argv.slice(2);
  placeBuyOrder(ticker, Number(amount))
    .then(async (r) => {
      log(`placed buy ${r.usdc} USDC of ${r.ticker}`);
      log(`user       : ${r.user}`);
      log(`order_id   : ${r.orderId}`);
      log(`pda        : ${r.pda}`);
      log(`signature  : ${r.signature}`);
      log(`explorer   : https://explorer.solana.com/tx/${r.signature}?cluster=devnet`);
      if (flags.includes('--wait')) {
        const o = await waitForTerminal(r.user, r.orderId);
        log(`terminal: ${o.status} settle=${o.settleSignature}`);
      }
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exit(1);
    });
}
