import { Body, Controller, Delete, Get, HttpCode, HttpException, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MockBrokerService, MockRejection, type FaultMode } from './mock-broker.service';

/**
 * Mirrors the Alpaca endpoints the pipeline relies on:
 *   POST /orders                      -> 202 accepted | 409 duplicate (original order) | 422 rejected
 *   GET  /orders/:id                  -> current status
 *   GET  /orders?client_order_id=...  -> recovery lookup (404 if unknown)
 *   DELETE /orders/:id                -> cancel before fill
 * Admin:
 *   POST /admin/faults {mode, durationMs, slowMs, failRate, fillDelayMs}
 *   POST /admin/orders/:id/fill       -> force a fill now (reconciliation scenario)
 *   GET  /admin/state, POST /admin/reset
 */
@Controller()
export class MockBrokerController {
  constructor(private readonly svc: MockBrokerService) {}

  @Post('orders')
  async place(@Body() body: { client_order_id: string; symbol: string; side?: 'buy' | 'sell'; notional: string }, @Res() res: Response) {
    await this.svc.gate();
    if (!body?.client_order_id || !body?.symbol || !body?.notional) {
      throw new HttpException({ code: 'bad_request', message: 'client_order_id, symbol, notional required' }, 400);
    }
    try {
      const { order, duplicate } = this.svc.place({ ...body, side: body.side ?? 'buy' });
      res.status(duplicate ? 409 : 202).json(order);
    } catch (e) {
      if (e instanceof MockRejection) throw new HttpException({ code: e.code, message: e.message }, 422);
      throw e;
    }
  }

  @Get('orders')
  async byClientId(@Query('client_order_id') clientOrderId: string) {
    await this.svc.gate();
    const o = this.svc.findByClientId(clientOrderId);
    if (!o) throw new NotFoundException({ code: 'not_found', message: 'no order for client_order_id' });
    return o;
  }

  @Get('orders/:id')
  async get(@Param('id') id: string) {
    await this.svc.gate();
    const o = this.svc.get(id);
    if (!o) throw new NotFoundException({ code: 'not_found' });
    return o;
  }

  @Delete('orders/:id')
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    await this.svc.gate();
    const o = this.svc.cancel(id);
    if (!o) throw new NotFoundException({ code: 'not_found' });
    return o;
  }

  // ---- admin (never gated) ----

  @Post('admin/faults')
  setFaults(@Body() body: { mode?: FaultMode; durationMs?: number; slowMs?: number; slowMinMs?: number; slowMaxMs?: number; failRate?: number; fillDelayMs?: number; seed?: number }) {
    return this.svc.setFaults(body ?? {});
  }

  @Post('admin/orders/:id/fill')
  forceFill(@Param('id') id: string) {
    const o = this.svc.fill(id);
    if (!o) throw new NotFoundException({ code: 'not_found' });
    return o;
  }

  @Post('admin/orders/:id/reject')
  forceReject(@Param('id') id: string, @Body() body?: { reason?: string }) {
    const o = this.svc.reject(id, body?.reason);
    if (!o) throw new NotFoundException({ code: 'not_found' });
    return o;
  }

  @Get('admin/state')
  state() {
    return this.svc.state();
  }

  @Get('admin/count')
  count(@Query('client_order_id') clientOrderId: string) {
    return { client_order_id: clientOrderId, count: this.svc.countByClientId(clientOrderId) };
  }

  @Post('admin/reset')
  reset() {
    this.svc.reset();
    return { ok: true };
  }

  @Get('health')
  health() {
    return { ok: true, faults: this.svc.faults };
  }
}
