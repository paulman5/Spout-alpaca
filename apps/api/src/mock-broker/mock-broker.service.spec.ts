import { MockBrokerService, MockRejection, seededRandom } from './mock-broker.service';

describe('MockBrokerService', () => {
  let svc: MockBrokerService;
  beforeEach(() => {
    svc = new MockBrokerService();
    svc.setFaults({ fillDelayMs: 60_000 }); // fills only when forced, keeps tests deterministic
  });
  afterEach(() => svc.reset());

  it('accepts an order and answers the same order for a duplicate client_order_id', () => {
    const first = svc.place({ client_order_id: 'c1', symbol: 'AAPL', side: 'buy', notional: '25' });
    const again = svc.place({ client_order_id: 'c1', symbol: 'AAPL', side: 'buy', notional: '25' });
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.order.brokerOrderId).toBe(first.order.brokerOrderId);
    expect(svc.countByClientId('c1')).toBe(1);
  });

  it('fills asynchronously (here: forced) with a deterministic price', () => {
    const { order } = svc.place({ client_order_id: 'c2', symbol: 'AAPL', side: 'buy', notional: '25' });
    expect(svc.get(order.brokerOrderId)?.status).toBe('accepted');
    const filled = svc.fill(order.brokerOrderId)!;
    expect(filled.status).toBe('filled');
    expect(Number(filled.filledNotional)).toBeCloseTo(25, 6);
    expect(Number(filled.filledQty)).toBeGreaterThan(0);
  });

  it('cancels only open orders and can reject an accepted order', () => {
    const a = svc.place({ client_order_id: 'c3', symbol: 'AAPL', side: 'buy', notional: '1' }).order;
    expect(svc.cancel(a.brokerOrderId)?.status).toBe('canceled');
    const b = svc.place({ client_order_id: 'c4', symbol: 'AAPL', side: 'buy', notional: '1' }).order;
    svc.fill(b.brokerOrderId);
    expect(svc.cancel(b.brokerOrderId)?.status).toBe('filled');
    const c = svc.place({ client_order_id: 'c5', symbol: 'AAPL', side: 'buy', notional: '1' }).order;
    expect(svc.reject(c.brokerOrderId, 'halted')?.rejectReason).toBe('halted');
  });

  it('rejects when the market is closed and for invalid symbols, without creating an order', () => {
    svc.setFaults({ mode: 'market_closed' });
    expect(() => svc.place({ client_order_id: 'c6', symbol: 'AAPL', side: 'buy', notional: '1' })).toThrow(MockRejection);
    svc.setFaults({ mode: 'none' });
    expect(() => svc.place({ client_order_id: 'c7', symbol: 'nope!', side: 'buy', notional: '1' })).toThrow(MockRejection);
    expect(svc.countByClientId('c6') + svc.countByClientId('c7')).toBe(0);
  });

  it('gate() throws on http500 and clears the fault after its duration', async () => {
    svc.setFaults({ mode: 'http500', durationMs: 50 });
    await expect(svc.gate()).rejects.toThrow('injected 500');
    await new Promise((r) => setTimeout(r, 70));
    await expect(svc.gate()).resolves.toBeUndefined();
    expect(svc.faults.mode).toBe('none');
  });

  it('flaky failures are reproducible from the seed', async () => {
    const outcomes = async (seed: number) => {
      const s = new MockBrokerService();
      s.setFaults({ mode: 'flaky', failRate: 0.5, seed });
      const out: boolean[] = [];
      for (let i = 0; i < 12; i++) out.push(await s.gate().then(() => true, () => false));
      return out;
    };
    expect(await outcomes(7)).toEqual(await outcomes(7));
    expect(seededRandom(1)()).toBe(seededRandom(1)());
  });
});
