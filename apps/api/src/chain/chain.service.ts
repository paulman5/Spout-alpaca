import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AnchorProvider, BN, BorshCoder, EventParser, Program, Wallet } from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction, TransactionExpiredBlockheightExceededError, TransactionExpiredTimeoutError } from '@solana/web3.js';
import bs58 from 'bs58';
import { ORDERS_LITE_IDL, pendingOrderPda } from '@spout/shared';
import { ENV, type Env } from '../config/env';
import { loadKeypair } from './wallet';
import { ChainError, classifyChainError } from './chain.errors';
import { createResilientFetch, usePollingConfirmation } from './rpc';

export interface DecodedEvent {
  name: string;
  data: Record<string, unknown>;
}

export interface SettleResult {
  signature: string;
  outcome: 'confirmed' | 'already_settled';
}

/**
 * Everything that touches devnet: connection, event decoding, PDA lookups and the
 * settlement instructions. Signs with the platform keypair which, on this stripped
 * program, is also the order's user (see `CloseOrder` / `has_one = user` in lib.rs).
 */
@Injectable()
export class ChainService implements OnModuleInit {
  private readonly log = new Logger(ChainService.name);
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly keypair: Keypair;
  private program!: Program;
  private eventParser!: EventParser;

  constructor(@Inject(ENV) private readonly env: Env) {
    const endpoints = [env.RPC_URL, ...env.RPC_URLS.split(',').map((s) => s.trim()).filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i);
    this.connection = usePollingConfirmation(
      new Connection(env.RPC_URL, {
        commitment: 'confirmed',
        wsEndpoint: env.WS_URL,
        disableRetryOnRateLimit: true,
        fetch: createResilientFetch({
          endpoints,
          minIntervalMs: env.RPC_MIN_INTERVAL_MS,
          onRetry: (i) => this.log.warn(`rpc retry ${i.attempt} (${i.reason}) via ${i.endpoint.replace(/api-key=.*/, 'api-key=…')} in ${i.delayMs}ms`),
        }),
      }),
    );
    this.programId = new PublicKey(env.PROGRAM_ID);
    this.keypair = loadKeypair(env);
  }

  onModuleInit() {
    const idl = ORDERS_LITE_IDL as unknown as Idl;
    const provider = new AnchorProvider(this.connection, new Wallet(this.keypair), { commitment: 'confirmed' });
    this.program = new Program(idl, provider);
    this.eventParser = new EventParser(this.programId, new BorshCoder(idl));
    this.log.log(`wallet=${this.keypair.publicKey.toBase58()} program=${this.programId.toBase58()} rpc=${this.env.RPC_URL}`);
  }

  get wallet(): PublicKey {
    return this.keypair.publicKey;
  }

  /** Decode Anchor `Program data:` lines into named events. */
  decodeLogs(logs: string[]): DecodedEvent[] {
    const out: DecodedEvent[] = [];
    for (const ev of this.eventParser.parseLogs(logs)) {
      out.push({ name: ev.name, data: normalize(ev.data as Record<string, unknown>) });
    }
    return out;
  }

  /**
   * Demo helper: place a buy order on devnet with the service keypair (on this stripped
   * program the platform key doubles as the user, as in the reference script).
   */
  async placeBuyOrder(ticker: string, usdc: number): Promise<{ user: string; orderId: string; pda: string; signature: string }> {
    const orderId = new BN(Date.now());
    const units = new BN(Math.round(usdc * 1e6));
    const pda = pendingOrderPda(this.wallet, orderId.toString(), this.programId);
    const signature: string = await this.program.methods['placeBuyOrder']!(orderId, ticker, units).accounts({ user: this.wallet }).rpc();
    this.log.log(`placed buy ${usdc} USDC of ${ticker}: order ${orderId.toString()} sig=${signature}`);
    return { user: this.wallet.toBase58(), orderId: orderId.toString(), pda: pda.toBase58(), signature };
  }

  async pdaExists(user: string, orderId: string): Promise<boolean> {
    const pda = pendingOrderPda(new PublicKey(user), orderId, this.programId);
    const info = await this.connection.getAccountInfo(pda, 'confirmed');
    return info !== null;
  }

  /**
   * How a closed PDA was closed, read from the chain: the last transactions that touched
   * the PDA address carry the BuyOrderFulfilled / BuyOrderRefunded event.
   */
  async findCloseEvent(user: string, orderId: string): Promise<{ outcome: 'settled' | 'refunded'; signature: string } | null> {
    const pda = pendingOrderPda(new PublicKey(user), orderId, this.programId);
    const sigs = await this.connection.getSignaturesForAddress(pda, { limit: 5 }, 'confirmed');
    for (const s of sigs) {
      if (s.err) continue;
      const tx = await this.connection.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      for (const ev of this.decodeLogs(tx?.meta?.logMessages ?? [])) {
        if (ev.name === 'BuyOrderFulfilled' || ev.name === 'SellOrderFulfilled') return { outcome: 'settled', signature: s.signature };
        if (ev.name === 'BuyOrderRefunded' || ev.name === 'SellOrderRefunded') return { outcome: 'refunded', signature: s.signature };
      }
    }
    return null;
  }

  async fulfillBuyOrder(
    user: string,
    orderId: string,
    actualUsdc: string,
    persistSignature?: (sig: string) => Promise<void>,
  ): Promise<SettleResult> {
    const tx = await this.program.methods
      ['fulfillBuyOrder']!(new BN(orderId), new BN(actualUsdc))
      .accounts({ user: new PublicKey(user) })
      .transaction();
    return this.sendSettlement(tx, user, orderId, persistSignature);
  }

  async refundBuyOrder(user: string, orderId: string, persistSignature?: (sig: string) => Promise<void>): Promise<SettleResult> {
    const tx = await this.program.methods
      ['refundBuyOrder']!(new BN(orderId))
      .accounts({ user: new PublicKey(user) })
      .transaction();
    return this.sendSettlement(tx, user, orderId, persistSignature);
  }

  /** Has a previously sent settlement signature landed? */
  async signatureStatus(signature: string): Promise<'confirmed' | 'failed' | 'unknown'> {
    const st = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const s = st.value[0];
    if (!s) return 'unknown';
    if (s.err) return 'failed';
    return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? 'confirmed' : 'unknown';
  }

  /**
   * Sign locally, persist the signature BEFORE sending (so a lost confirmation can be
   * re-checked instead of blindly re-sent), then send + confirm. A 3012 at preflight
   * or at confirmation means the PDA is already closed -> already settled.
   */
  private async sendSettlement(
    tx: Transaction,
    user: string,
    orderId: string,
    persistSignature?: (sig: string) => Promise<void>,
  ): Promise<SettleResult> {
    if (user !== this.wallet.toBase58()) {
      throw new ChainError('permanent', `Cannot settle order of ${user}: this worker only signs for ${this.wallet.toBase58()}`);
    }
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.wallet;
    tx.sign(this.keypair);
    const signature = bs58.encode(tx.signature!);
    if (persistSignature) await persistSignature(signature);

    try {
      await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
    } catch (err) {
      throw classifyChainError(err, signature);
    }

    if (this.env.CHAIN_FAULT === 'drop_confirmation') {
      // Scenario D: the tx is on its way, but we pretend the confirmation never came back.
      this.log.warn(`CHAIN_FAULT=drop_confirmation: simulating lost confirmation for ${signature}`);
      throw new ChainError('transient', 'simulated confirmation timeout', signature);
    }

    try {
      const res = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      if (res.value.err) {
        const txInfo = await this.connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        throw classifyChainError({ message: JSON.stringify(res.value.err), logs: txInfo?.meta?.logMessages ?? [] }, signature);
      }
    } catch (err) {
      if (err instanceof ChainError) throw err;
      if (err instanceof TransactionExpiredTimeoutError || err instanceof TransactionExpiredBlockheightExceededError) {
        throw new ChainError('transient', `confirmation timeout for ${signature}`, signature, err);
      }
      if (err instanceof Error && /not confirmed within|expired: block height/.test(err.message)) {
        throw new ChainError('transient', err.message, signature, err);
      }
      if (err instanceof Error && /failed on-chain/.test(err.message)) {
        // Fetch the logs so a custom program error (e.g. 3012) is classified correctly.
        const txInfo = await this.connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
        throw classifyChainError({ message: err.message, logs: txInfo?.meta?.logMessages ?? [] }, signature);
      }
      throw classifyChainError(err, signature);
    }
    this.log.log(`settlement confirmed ${user.slice(0, 6)}/${orderId} sig=${signature}`);
    return { signature, outcome: 'confirmed' };
  }
}

/**
 * Anchor returns PublicKey / BN instances (possibly from a different copy of the
 * library, so no instanceof) and IDL field names in snake_case; the pipeline
 * works with base58 / decimal strings and camelCase keys.
 */
function normalize(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, v] of Object.entries(data)) {
    const k = rawKey.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (v && typeof v === 'object' && typeof (v as { toBase58?: unknown }).toBase58 === 'function') out[k] = (v as PublicKey).toBase58();
    else if (BN.isBN(v)) out[k] = (v as BN).toString(10);
    else if (typeof v === 'bigint') out[k] = v.toString(10);
    else out[k] = v;
  }
  return out;
}
