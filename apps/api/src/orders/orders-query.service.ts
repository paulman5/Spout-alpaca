import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { OrderEventView, OrderView } from '@spout/shared';
import { Order } from './entities/order.entity';
import { OrderEvent } from './entities/order-event.entity';
import { Alert } from './entities/alert.entity';

@Injectable()
export class OrdersQueryService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderEvent) private readonly events: Repository<OrderEvent>,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
  ) {}

  async list(limit = 100): Promise<OrderView[]> {
    const rows = await this.orders.find({ order: { createdAt: 'DESC' }, take: limit });
    return rows.map(toView);
  }

  async get(userPubkey: string, orderId: string): Promise<OrderView | null> {
    const row = await this.orders.findOne({ where: { userPubkey, orderId } });
    return row ? toView(row) : null;
  }

  async history(userPubkey: string, orderId: string): Promise<OrderEventView[]> {
    const rows = await this.events.find({ where: { userPubkey, orderId }, order: { id: 'ASC' } });
    return rows.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      reason: e.reason,
      details: e.details,
      actor: e.actor,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async recentEvents(limit = 50) {
    return this.events.find({ order: { id: 'DESC' }, take: limit });
  }

  async listAlerts(limit = 50) {
    return this.alerts.find({ where: { acknowledgedAt: IsNull() }, order: { id: 'DESC' }, take: limit });
  }
}

export function toView(o: Order): OrderView {
  return {
    userPubkey: o.userPubkey,
    orderId: o.orderId,
    side: o.side,
    ticker: o.ticker,
    amount: o.amount,
    status: o.status,
    clientOrderId: o.clientOrderId,
    brokerOrderId: o.brokerOrderId,
    brokerStatus: o.brokerStatus,
    filledNotional: o.filledNotional,
    filledQty: o.filledQty,
    settleSignature: o.settleSignature,
    createdSignature: o.createdSignature,
    attempts: o.attempts,
    nextAttemptAt: o.nextAttemptAt ? o.nextAttemptAt.toISOString() : null,
    lockedBy: o.lockedBy,
    lastError: o.lastError,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}
