import type { EntityManager } from 'typeorm';
import { IllegalTransitionError, LedgerService, StaleOrderError } from './ledger.service';
import type { Order } from './entities/order.entity';
import type { Env } from '../config/env';

/** Minimal EntityManager stand-in: records the UPDATE's where-parameters and inserts, returns a configurable affected count. */
function fakeManager(affected: number) {
  const calls: { where?: Record<string, unknown>; inserts: unknown[]; queries: string[] } = { inserts: [], queries: [] };
  const qb = {
    update: () => qb,
    set: () => qb,
    where: (_sql: string, params: Record<string, unknown>) => {
      calls.where = params;
      return qb;
    },
    execute: async () => ({ affected }),
  };
  const m = {
    createQueryBuilder: () => qb,
    insert: async (_entity: unknown, values: unknown) => {
      calls.inserts.push(values);
    },
    query: async (sql: string) => {
      calls.queries.push(sql);
      return [{ n: 0 }];
    },
  } as unknown as EntityManager;
  return { m, calls };
}

const env = { CIRCUIT_BREAKER_ALERTS: 3, CIRCUIT_BREAKER_WINDOW_MS: 600_000 } as Env;
const order = () => ({ userPubkey: 'user', orderId: '1', status: 'broker_placing' }) as Order;

describe('LedgerService', () => {
  it('writes the projection and the ledger line together, fenced on the current status', async () => {
    const { m, calls } = fakeManager(1);
    const o = order();
    await new LedgerService(env).transition(m, o, 'broker_placed', 'broker_accepted', 'worker:test', { brokerOrderId: 'b1' });
    expect(calls.where).toMatchObject({ u: 'user', o: '1', from: 'broker_placing' });
    expect(o.status).toBe('broker_placed');
    expect(o.brokerOrderId).toBe('b1');
    expect(calls.inserts[0]).toMatchObject({ fromStatus: 'broker_placing', toStatus: 'broker_placed', reason: 'broker_accepted', actor: 'worker:test' });
  });

  it('refuses a transition the state machine does not allow', async () => {
    const { m } = fakeManager(1);
    await expect(new LedgerService(env).transition(m, order(), 'settled', 'x', 'test')).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('throws StaleOrderError when another process already moved the row (0 rows fenced)', async () => {
    const { m, calls } = fakeManager(0);
    const o = order();
    await expect(new LedgerService(env).transition(m, o, 'broker_placed', 'broker_accepted', 'test')).rejects.toBeInstanceOf(StaleOrderError);
    expect(o.status).toBe('broker_placing');
    expect(calls.inserts).toHaveLength(0);
  });

  it('a critical alert consults the circuit breaker window', async () => {
    const { m, calls } = fakeManager(1);
    await new LedgerService(env).alert(m, order(), 'critical', 'boom');
    expect(calls.inserts).toHaveLength(1);
    expect(calls.queries.some((q) => /count\(\*\)/.test(q))).toBe(true);
  });
});
