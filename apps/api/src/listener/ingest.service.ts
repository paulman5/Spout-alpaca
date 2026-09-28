import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { clientOrderId } from '@spout/shared';
import { ChainService } from '../chain/chain.service';

export interface IngestInput {
  signature: string;
  slot: number | null;
  logs: string[];
  source: 'ws' | 'backfill' | 'replay';
}

export interface IngestResult {
  signature: string;
  events: number;
  newRawEvents: number;
  duplicateRawEvents: number;
  newOrders: number;
  foreignSkipped: number;
  names: string[];
  /** where the replay took its data from */
  origin?: 'db' | 'rpc';
}

/**
 * The single entry point for chain events, whatever their origin (websocket,
 * backfill, manual replay). Idempotent by construction:
 *   raw_events  PK (signature, event_index)  -> ON CONFLICT DO NOTHING
 *   orders      PK (user_pubkey, order_id)   -> ON CONFLICT DO NOTHING
 * so replaying the same transaction N times leaves exactly one order.
 * The raw program logs are stored with the event, so a replay never needs the RPC.
 */
@Injectable()
export class IngestService {
  private readonly log = new Logger(IngestService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly chain: ChainService,
  ) {}

  async ingest(input: IngestInput): Promise<IngestResult> {
    const events = this.chain.decodeLogs(input.logs); // decode the "Program data:" lines with the program IDL
    const result: IngestResult = {
      signature: input.signature,
      events: events.length,
      newRawEvents: 0,
      duplicateRawEvents: 0,
      newOrders: 0,
      foreignSkipped: 0,
      names: events.map((e) => e.name),
    };
    if (events.length === 0) return result;
    const me = this.chain.wallet.toBase58(); // the only user whose orders this service can settle (has_one = user)

    await this.ds.transaction(async (m) => {
      // One database transaction per chain transaction: raw events, order row and ledger line land together or not at all.
      for (const [index, ev] of events.entries()) {
        const user = typeof ev.data['user'] === 'string' ? ev.data['user'] : null;
        const orderId = typeof ev.data['orderId'] === 'string' ? ev.data['orderId'] : null;

        const raw = await m.query(
          `INSERT INTO raw_events (signature, event_index, slot, event_name, user_pubkey, order_id, payload, logs, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING signature`,
          [input.signature, index, input.slot, ev.name, user, orderId, JSON.stringify(ev.data), input.logs, input.source],
        );
        if (raw.length) result.newRawEvents++;
        else result.duplicateRawEvents++; // primary key (signature, event_index) already there: a replay or a reconnect

        if (!user || !orderId) continue;
        if (user !== me) {
          // Shared devnet program: other keypairs' orders. We cannot sign for them (has_one = user).
          result.foreignSkipped++;
          continue;
        }

        if (ev.name === 'BuyOrderCreated') {
          const inserted = await m.query(
            `INSERT INTO orders (user_pubkey, order_id, side, ticker, amount, status, client_order_id, created_signature, created_slot, next_attempt_at)
             VALUES ($1,$2,'buy',$3,$4,'recorded',$5,$6,$7,now()) ON CONFLICT DO NOTHING RETURNING order_id`,
            [user, orderId, ev.data['ticker'], ev.data['usdcAmount'], clientOrderId(user, orderId), input.signature, input.slot],
          );
          if (inserted.length) {
            // First time we see this business key: the order starts its life as 'recorded'.
            result.newOrders++;
            await m.query(
              `INSERT INTO order_events (user_pubkey, order_id, from_status, to_status, reason, details, actor)
               VALUES ($1,$2,NULL,'recorded','event_ingested',$3,$4)`,
              [user, orderId, JSON.stringify({ signature: input.signature, slot: input.slot, source: input.source, ticker: ev.data['ticker'], usdcAmount: ev.data['usdcAmount'] }), `listener:${input.source}`],
            );
          } else {
            // Same business key seen again (replay, reconnect, backfill): audit it, change nothing.
            await m.query(
              `INSERT INTO order_events (user_pubkey, order_id, from_status, to_status, reason, details, actor)
               SELECT $1, $2, status, status, 'duplicate_event_ignored', $3, $4 FROM orders WHERE user_pubkey=$1 AND order_id=$2`,
              [user, orderId, JSON.stringify({ signature: input.signature, source: input.source }), `listener:${input.source}`],
            );
          }
        } else if (ev.name === 'SellOrderCreated') {
          // Captured in raw_events for the audit trail; sell settlement is out of scope for this worker.
        } else {
          // BuyOrderFulfilled / BuyOrderRefunded / Sell*: observed on-chain terminal events, noted on the ledger if we know the order.
          await m.query(
            `INSERT INTO order_events (user_pubkey, order_id, from_status, to_status, reason, details, actor)
             SELECT $1, $2, status, status, $3, $4, $5 FROM orders WHERE user_pubkey=$1 AND order_id=$2`,
            [user, orderId, `chain_event_${ev.name}`, JSON.stringify({ signature: input.signature, source: input.source, ...ev.data }), `listener:${input.source}`],
          );
        }
      }
    });

    this.log.log(`${input.source} ${input.signature.slice(0, 12)}… ${result.names.join(',')} new_raw=${result.newRawEvents} dup=${result.duplicateRawEvents} new_orders=${result.newOrders} foreign=${result.foreignSkipped}`);
    return result;
  }

  /**
   * Re-run a transaction through ingest. Replays use the logs persisted in raw_events
   * (no RPC dependency, no ledger-retention dependency); the backfill and unknown
   * signatures fetch the transaction from the RPC.
   */
  async ingestSignature(signature: string, source: 'backfill' | 'replay'): Promise<IngestResult> {
    if (source === 'replay') {
      const stored = (await this.ds.query(`SELECT slot, logs FROM raw_events WHERE signature = $1 ORDER BY event_index LIMIT 1`, [signature])) as Array<{ slot: string | null; logs: string[] | null }>;
      if (stored[0]?.logs?.length) {
        const r = await this.ingest({ signature, slot: stored[0].slot ? Number(stored[0].slot) : null, logs: stored[0].logs, source });
        return { ...r, origin: 'db' };
      }
    }
    const tx = await this.chain.connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) throw new Error(`transaction ${signature} not found on ${this.chain.connection.rpcEndpoint}`);
    if (tx.meta?.err) return { signature, events: 0, newRawEvents: 0, duplicateRawEvents: 0, newOrders: 0, foreignSkipped: 0, names: [], origin: 'rpc' };
    const r = await this.ingest({ signature, slot: tx.slot, logs: tx.meta?.logMessages ?? [], source });
    return { ...r, origin: 'rpc' };
  }
}
