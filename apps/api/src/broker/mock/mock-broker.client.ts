import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import type { BrokerClient, BrokerOrder, PlaceOrderRequest, PlaceOrderResult } from '../broker.types';
import { BrokerError } from '../broker.errors';
import { httpJson } from '../http';

/**
 * HTTP client for the mock broker process (src/mock-broker). Same contract as
 * Alpaca from the worker's point of view; failures are injected server-side.
 */
@Injectable()
export class MockBrokerClient implements BrokerClient {
  readonly name = 'mock';

  constructor(@Inject(ENV) private readonly env: Env) {}

  private url(path: string) {
    return `${this.env.MOCK_BROKER_URL}${path}`;
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const res = await httpJson(this.url('/orders'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_order_id: req.clientOrderId, symbol: req.symbol, side: req.side, notional: req.notional }),
      allowStatuses: [409, 422],
      timeoutMs: 12_000,
    });
    if (res.status === 409) return { order: res.json<BrokerOrder>(), duplicate: true };
    if (res.status === 422) {
      const body = res.json<{ code?: string; message?: string }>();
      throw new BrokerError('permanent', body.message ?? 'rejected', 422, body.code ?? 'rejected');
    }
    return { order: res.json<BrokerOrder>(), duplicate: false };
  }

  async getOrder(brokerOrderId: string): Promise<BrokerOrder> {
    return (await httpJson(this.url(`/orders/${brokerOrderId}`))).json<BrokerOrder>();
  }

  async findByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null> {
    const res = await httpJson(this.url(`/orders?client_order_id=${encodeURIComponent(clientOrderId)}`), { allowStatuses: [404] });
    return res.status === 404 ? null : res.json<BrokerOrder>();
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    await httpJson(this.url(`/orders/${brokerOrderId}`), { method: 'DELETE', allowStatuses: [404] });
  }
}
