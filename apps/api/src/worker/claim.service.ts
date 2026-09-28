import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WORKABLE_STATUSES, type OrderStatus } from '@spout/shared';
import { ENV, type Env } from '../config/env';
import { Order } from '../orders/entities/order.entity';

/**
 * Row claims with leases. `FOR UPDATE SKIP LOCKED` makes N workers pick disjoint
 * rows without waiting on each other; the lease (`lock_expires_at`) makes a row
 * claimable again if its worker dies mid-flight (kill -9 never releases anything).
 */
@Injectable()
export class ClaimService {
  constructor(
    private readonly ds: DataSource,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async claim(
    workerId: string,
    opts: { limit?: number; statuses?: readonly OrderStatus[]; ignoreSchedule?: boolean; minAgeMs?: number } = {},
  ): Promise<Order[]> {
    const limit = opts.limit ?? this.env.WORKER_BATCH;
    const statuses = [...(opts.statuses ?? WORKABLE_STATUSES)];
    return this.ds.transaction(async (m) => {
      const qb = m
        .createQueryBuilder(Order, 'o')
        .where('o.status IN (:...statuses)', { statuses })
        // free rows, expired leases, or rows leased to *this* worker id (a restart with the same id resumes its own work)
        .andWhere('(o.lock_expires_at IS NULL OR o.lock_expires_at < now() OR o.locked_by = :me)', { me: workerId })
        .orderBy('o.updated_at', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write') // SELECT ... FOR UPDATE
        .setOnLocked('skip_locked'); // SKIP LOCKED: rows another worker holds are simply not seen, nobody waits
      if (!opts.ignoreSchedule) qb.andWhere('(o.next_attempt_at IS NULL OR o.next_attempt_at <= now())');
      if (opts.minAgeMs) qb.andWhere("o.updated_at < now() - (:age || ' milliseconds')::interval", { age: String(opts.minAgeMs) });

      const rows = await qb.getMany();
      if (rows.length === 0) return [];
      const expires = new Date(Date.now() + this.env.LEASE_SECONDS * 1000); // the lease: expires by itself if this worker dies
      for (const r of rows) {
        await m.update(Order, { userPubkey: r.userPubkey, orderId: r.orderId }, { lockedBy: workerId, lockExpiresAt: expires });
      }
      for (const r of rows) {
        r.lockedBy = workerId;
        r.lockExpiresAt = expires;
      }
      return rows;
    });
  }

  /** Extend the lease while a long step (broker slow path, confirmation wait) is running. */
  async heartbeat(order: Order, workerId: string): Promise<void> {
    const expires = new Date(Date.now() + this.env.LEASE_SECONDS * 1000);
    await this.ds.getRepository(Order).update({ userPubkey: order.userPubkey, orderId: order.orderId, lockedBy: workerId }, { lockExpiresAt: expires });
  }

  async release(order: Order, workerId: string): Promise<void> {
    await this.ds.getRepository(Order).update({ userPubkey: order.userPubkey, orderId: order.orderId, lockedBy: workerId }, { lockedBy: null, lockExpiresAt: null });
  }
}
