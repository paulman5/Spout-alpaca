import { alpacaRejectCode, isDuplicateBody, mapOrder } from './alpaca-broker.client';

const base = { id: 'ord-1', client_order_id: 'spout-user-1', symbol: 'AAPL', notional: '25', qty: null };

describe('Alpaca order mapping', () => {
  it('maps open states to accepted', () => {
    for (const status of ['new', 'accepted', 'pending_new', 'partially_filled', 'held', 'pending_cancel']) {
      const o = mapOrder({ ...base, status, filled_qty: status === 'partially_filled' ? '0.05' : '0' });
      expect(o.status).toBe('accepted');
      expect(o.partial).toBe(false);
    }
  });

  it('maps a full fill with the filled notional from qty x avg price', () => {
    const o = mapOrder({ ...base, status: 'filled', filled_qty: '0.1', filled_avg_price: '250' });
    expect(o.status).toBe('filled');
    expect(o.filledQty).toBe('0.1');
    expect(o.filledNotional).toBe('25.000000');
    expect(o.partial).toBe(false);
  });

  it('never reports a partially filled then closed order as canceled or rejected', () => {
    for (const status of ['canceled', 'expired', 'done_for_day']) {
      const o = mapOrder({ ...base, status, filled_qty: '0.04', filled_avg_price: '250' });
      expect(o.status).toBe('filled');
      expect(o.partial).toBe(true);
      expect(o.filledNotional).toBe('10.000000');
    }
  });

  it('maps closed orders with no fill to canceled / rejected', () => {
    expect(mapOrder({ ...base, status: 'canceled', filled_qty: '0' }).status).toBe('canceled');
    expect(mapOrder({ ...base, status: 'expired', filled_qty: '0' }).status).toBe('rejected');
    expect(mapOrder({ ...base, status: 'rejected' }).rejectReason).toBe('rejected');
  });
});

describe('Alpaca rejection parsing', () => {
  it('detects the duplicate client_order_id by message only (42210000 is a generic validation code)', () => {
    expect(isDuplicateBody('{"code":42210000,"message":"client_order_id must be unique"}')).toBe(true);
    expect(isDuplicateBody('{"code":42210000,"message":"notional must be positive"}')).toBe(false);
  });

  it('extracts a machine code for the ledger', () => {
    expect(alpacaRejectCode('{"code":42210000,"message":"market is closed"}')).toBe('market_closed');
    expect(alpacaRejectCode('{"code":40410000,"message":"asset not found"}')).toBe('invalid_symbol');
    expect(alpacaRejectCode('{"code":40310000,"message":"insufficient buying power"}')).toBe('insufficient_funds');
    expect(alpacaRejectCode('{"code":42210000,"message":"something else"}')).toBe('alpaca_42210000');
    expect(alpacaRejectCode('not json')).toBe('rejected');
  });
});
