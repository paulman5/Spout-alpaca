import { backoffMs, classifyFailure, isExhausted } from './retry.policy';
import { BrokerError, classifyHttpFailure } from '../broker/broker.errors';
import { ChainError, classifyChainError } from '../chain/chain.errors';

const cfg = { maxAttempts: 10, baseMs: 1000, maxMs: 60000 };

describe('retry policy', () => {
  it('doubles from 1s and caps at 60s', () => {
    const fixed = () => 0.5; // jitter factor 1.0
    expect(backoffMs(1, cfg, fixed)).toBe(1000);
    expect(backoffMs(2, cfg, fixed)).toBe(2000);
    expect(backoffMs(3, cfg, fixed)).toBe(4000);
    expect(backoffMs(6, cfg, fixed)).toBe(32000);
    expect(backoffMs(7, cfg, fixed)).toBe(60000);
    expect(backoffMs(10, cfg, fixed)).toBe(60000);
  });

  it('exhausts after maxAttempts', () => {
    expect(isExhausted(9, cfg)).toBe(false);
    expect(isExhausted(10, cfg)).toBe(true);
  });

  it('classifies broker HTTP failures', () => {
    expect(classifyHttpFailure(500, 'boom').kind).toBe('transient');
    expect(classifyHttpFailure(503, '').kind).toBe('transient');
    expect(classifyHttpFailure(429, '').kind).toBe('transient');
    expect(classifyHttpFailure(422, '{"code":"market_closed"}').kind).toBe('permanent');
    expect(classifyHttpFailure(403, 'forbidden').kind).toBe('permanent');
    expect(classifyHttpFailure(400, 'invalid symbol').kind).toBe('permanent');
  });

  it('classifies chain failures, 3012 is already_settled', () => {
    expect(classifyChainError(new Error('Simulation failed. custom program error: 0xbc4')).kind).toBe('already_settled');
    expect(classifyChainError({ message: 'x', logs: ['Program log: AnchorError ... Error Number: 3012. Error Message: The program expected this account to be already initialized.'] }).kind).toBe('already_settled');
    expect(classifyChainError(new Error('Blockhash not found')).kind).toBe('transient');
    expect(classifyChainError(new Error('Error Code: WrongOrderSide. Error Number: 6002')).kind).toBe('permanent');
  });

  it('routes unknown errors to transient (retry), typed errors to their kind', () => {
    expect(classifyFailure(new Error('ECONNRESET'))).toBe('transient');
    expect(classifyFailure(new BrokerError('permanent', 'nope'))).toBe('permanent');
    expect(classifyFailure(new ChainError('already_settled', 'gone'))).toBe('already_settled');
  });
});
