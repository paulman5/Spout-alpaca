import { TRANSITIONS, canTransition, clientOrderId, isTerminal, parseClientOrderId } from '@spout/shared';
import { actualUsdc, usdcToNotional } from './order.processor';
import type { Order } from '../orders/entities/order.entity';

describe('amount conversions', () => {
  it('turns on-chain 6dp USDC into a 2dp broker notional', () => {
    expect(usdcToNotional('25000000')).toBe('25.00');
    expect(usdcToNotional('2500123456')).toBe('2500.12');
  });

  it('reports the filled notional on-chain, capped by the escrowed amount', () => {
    expect(actualUsdc({ amount: '25000000', filledNotional: '24.990000' } as Order)).toBe('24990000');
    expect(actualUsdc({ amount: '25000000', filledNotional: '25.500000' } as Order)).toBe('25000000');
    expect(actualUsdc({ amount: '25000000', filledNotional: null } as Order)).toBe('25000000');
  });
});

describe('business key', () => {
  it('derives a deterministic client_order_id and parses it back', () => {
    const id = clientOrderId('BLcWH9MWxKkFNNZj7mBm3vF7aiZieG3BnZMWXtoiktoC', '1788736966095');
    expect(id).toBe('spout-BLcWH9MWxKkFNNZj7mBm3vF7aiZieG3BnZMWXtoiktoC-1788736966095');
    expect(id.length).toBeLessThanOrEqual(128);
    expect(parseClientOrderId(id)).toEqual({ userPubkey: 'BLcWH9MWxKkFNNZj7mBm3vF7aiZieG3BnZMWXtoiktoC', orderId: '1788736966095' });
    expect(parseClientOrderId('nope')).toBeNull();
  });
});

describe('state machine', () => {
  it('terminal states have no outgoing transitions', () => {
    for (const s of ['settled', 'refunded', 'needs_human'] as const) {
      expect(isTerminal(s)).toBe(true);
      expect(TRANSITIONS[s]).toEqual([]);
    }
  });

  it('a filled order can only be settled or escalated, never refunded', () => {
    expect(canTransition('filled', 'refunding')).toBe(false);
    expect(canTransition('settling', 'refunding')).toBe(false);
    expect(canTransition('filled', 'settling')).toBe(true);
    expect(canTransition('filled', 'needs_human')).toBe(true);
  });

  it('a recorded order can be closed without trading when the PDA is already gone', () => {
    expect(canTransition('recorded', 'settled')).toBe(true);
    expect(canTransition('recorded', 'refunded')).toBe(true);
    expect(canTransition('recorded', 'needs_human')).toBe(true);
  });
});
