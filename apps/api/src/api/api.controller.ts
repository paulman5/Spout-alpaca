import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminGuard } from './admin.guard';
import { interval, map, startWith, switchMap } from 'rxjs';
import { ENV, type Env } from '../config/env';
import { OrdersQueryService } from '../orders/orders-query.service';
import { IngestService } from '../listener/ingest.service';
import { ReconcileService } from '../reconcile/reconcile.service';
import { ChainService } from '../chain/chain.service';
import { httpJson } from '../broker/http';
import { DataSource } from 'typeorm';
import type { OrderStatus } from '@spout/shared';
import { Order } from '../orders/entities/order.entity';
import { OrderEvent } from '../orders/entities/order-event.entity';
import { PipelineControlService } from '../orders/pipeline-control.service';

@Controller()
export class ApiController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly orders: OrdersQueryService,
    private readonly ingest: IngestService,
    private readonly reconcile: ReconcileService,
    private readonly chain: ChainService,
    private readonly ds: DataSource,
    private readonly control: PipelineControlService,
  ) {}

  /** Service index: JSON for tools, a small HTML page for a browser. */
  @Get()
  index(@Req() req: Request, @Res() res: Response) {
    const info = {
      service: 'spout-settlement-api',
      description: 'Settlement worker for tokenized equities: devnet orders-lite -> broker -> on-chain settlement.',
      broker: this.env.BROKER,
      network: 'solana-devnet',
      program: this.chain.programId.toBase58(),
      wallet: this.chain.wallet.toBase58(),
      console: 'https://spout-settlement-console.vercel.app',
      endpoints: {
        health: 'GET /health',
        config: 'GET /config',
        orders: 'GET /orders?limit=100',
        place: 'POST /orders/place {ticker, usdc} (header x-admin-token; demo helper, signs with the service keypair)',
        order: 'GET /orders/:user/:orderId',
        ledger: 'GET /orders/:user/:orderId/events',
        events: 'GET /events?limit=50',
        alerts: 'GET /alerts',
        stream: 'GET /stream (server-sent events)',
        workers: 'GET /workers',
        admin: 'POST /workers/pause|resume, /reconcile, /replay, /alerts/:id/ack, /mock/faults (header x-admin-token)',
      },
      time: new Date().toISOString(),
    };
    if (!/text\/html/.test(req.headers.accept ?? '')) return res.json(info);
    const rows = Object.entries(info.endpoints)
      .map(([k, v]) => `<tr><td>${k}</td><td><code>${v.replace(/</g, '&lt;')}</code></td></tr>`)
      .join('');
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Spout settlement API</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#070709;color:#eae7df;font:15px/1.7 Inter,system-ui,sans-serif}
main{max-width:52rem;margin:0 auto;padding:4rem 1.5rem}
h1{font:300 2.6rem/1.05 Georgia,"Iowan Old Style",serif;letter-spacing:-.02em;margin:0 0 .5rem}
h1 em{font-style:italic;font-weight:400}
p{color:rgba(234,231,223,.62);max-width:60ch}
.k{font:500 .6875rem/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:rgba(234,231,223,.4)}
.k::before{content:"";display:inline-block;width:.9rem;height:1px;background:#39c5bb;vertical-align:middle;margin-right:.7rem}
table{width:100%;border-collapse:collapse;margin-top:1.5rem;border:1px solid rgba(234,231,223,.14)}
td{padding:.6rem 1rem;border-bottom:1px solid rgba(234,231,223,.07);vertical-align:top}
td:first-child{font:500 .625rem/1.8 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:rgba(234,231,223,.4);white-space:nowrap}
code{font:.8125rem ui-monospace,Menlo,monospace;color:#eae7df}
a{color:#eae7df;text-decoration:underline;text-decoration-color:#39c5bb;text-underline-offset:4px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.3rem 1.5rem;margin:1.5rem 0 0}
dt{font:500 .625rem/1.9 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:rgba(234,231,223,.4)}
dd{margin:0;font:.8125rem/1.9 ui-monospace,Menlo,monospace;color:rgba(234,231,223,.75);word-break:break-all}
</style></head><body><main>
<span class="k">Spout · settlement API</span>
<h1>Every order, <em>accounted for.</em></h1>
<p>${info.description} This is the machine interface; the operator console is at <a href="${info.console}">${info.console.replace('https://', '')}</a>.</p>
<dl><dt>broker</dt><dd>${info.broker}</dd><dt>network</dt><dd>${info.network}</dd><dt>program</dt><dd>${info.program}</dd><dt>wallet</dt><dd>${info.wallet}</dd><dt>time</dt><dd>${info.time}</dd></dl>
<table>${rows}</table>
<p style="margin-top:1.5rem;font-size:.8125rem">Same content as JSON: <code>curl -H "Accept: application/json" ${req.protocol}://${req.get('host')}/</code></p>
</main></body></html>`);
  }

  @Get('health')
  health() {
    return { ok: true, role: this.env.ROLE, time: new Date().toISOString() };
  }

  @Get('config')
  config() {
    return {
      broker: this.env.BROKER,
      wallet: this.chain.wallet.toBase58(),
      programId: this.chain.programId.toBase58(),
      rpcUrl: this.env.RPC_URL,
      mockBrokerUrl: this.env.MOCK_BROKER_URL,
    };
  }

  @Get('orders')
  list(@Query('limit') limit?: string) {
    return this.orders.list(limit ? Number(limit) : 100);
  }

  /** Demo helper: place a real devnet buy order with the service keypair (same as `pnpm place-order`). */
  @UseGuards(AdminGuard)
  @Post('orders/place')
  async place(@Body() body: { ticker?: string; usdc?: number }) {
    const ticker = String(body?.ticker ?? 'AAPL').trim().toUpperCase();
    const usdc = Number(body?.usdc ?? 5);
    if (!/^[A-Z.]{1,8}$/.test(ticker)) throw new BadRequestException('ticker must be 1 to 8 letters');
    if (!Number.isFinite(usdc) || usdc < 1 || usdc > 1000) throw new BadRequestException('usdc must be between 1 and 1000');
    const placed = await this.chain.placeBuyOrder(ticker, usdc);
    return { ...placed, ticker, usdc, explorer: `https://explorer.solana.com/tx/${placed.signature}?cluster=devnet` };
  }

  @Get('orders/:user/:orderId')
  async get(@Param('user') user: string, @Param('orderId') orderId: string) {
    const o = await this.orders.get(user, orderId);
    if (!o) throw new NotFoundException();
    return o;
  }

  @Get('orders/:user/:orderId/events')
  history(@Param('user') user: string, @Param('orderId') orderId: string) {
    return this.orders.history(user, orderId);
  }

  @Get('events')
  events(@Query('limit') limit?: string) {
    return this.orders.recentEvents(limit ? Number(limit) : 50);
  }

  @Get('alerts')
  alerts() {
    return this.orders.listAlerts();
  }

  /** A human has looked at it: keeps the panel and the circuit-breaker window honest. */
  @UseGuards(AdminGuard)
  @Post('alerts/:id/ack')
  async ackAlert(@Param('id') id: string) {
    await this.ds.query(`UPDATE alerts SET acknowledged_at = now() WHERE id = $1 AND acknowledged_at IS NULL`, [id]);
    return { ok: true };
  }

  /** Live feed for the web app: snapshot every second. */
  @Sse('stream')
  stream() {
    return interval(1000).pipe(
      startWith(0),
      switchMap(async () => ({ orders: await this.orders.list(100), events: await this.orders.recentEvents(30), alerts: await this.orders.listAlerts(20) })),
      map((data) => ({ data })),
    );
  }

  /** Scenario A: push an already-seen transaction through the pipeline again. */
  @UseGuards(AdminGuard)
  @Post('replay')
  replay(@Body() body: { signature: string }) {
    // Accept a bare signature or an explorer URL (.../tx/<signature>?cluster=devnet).
    const signature = String(body?.signature ?? '').trim().replace(/^.*\/tx\//, '').replace(/[?#].*$/, '');
    if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) throw new BadRequestException('signature must be a base58 transaction signature or an explorer link');
    return this.ingest.ingestSignature(signature, 'replay');
  }

  @UseGuards(AdminGuard)
  @Post('reconcile')
  runReconcile(@Body() body?: { minAgeMs?: number }) {
    return this.reconcile.run({ minAgeMs: body?.minAgeMs ?? 0 });
  }

  // ---- operations ----

  @Get('workers')
  async workers() {
    return { paused: await this.control.isPaused() };
  }

  /** Kill-switch: workers stop claiming new work (in-flight steps finish). */
  @UseGuards(AdminGuard)
  @Post('workers/pause')
  async pause() {
    await this.control.setPaused(true);
    return { paused: true };
  }

  @UseGuards(AdminGuard)
  @Post('workers/resume')
  async resume() {
    await this.control.setPaused(false);
    return { paused: false };
  }

  // ---- chaos hooks (demo/test only; see README "Scenarios") ----

  /** Inject DB drift for scenario F (recorded on the ledger so the repair is auditable). */
  @UseGuards(AdminGuard)
  @Post('orders/:user/:orderId/drift')
  async drift(
    @Param('user') user: string,
    @Param('orderId') orderId: string,
    @Body() body: { status?: OrderStatus; nextAttemptInMs?: number | null; settleSignature?: string | null; brokerStatus?: string | null },
  ) {
    await this.ds.transaction(async (m) => {
      const order = await m.findOneOrFail(Order, { where: { userPubkey: user, orderId } });
      const patch: Partial<Order> = {};
      if (body.status) patch.status = body.status;
      if (body.nextAttemptInMs !== undefined) patch.nextAttemptAt = body.nextAttemptInMs === null ? null : new Date(Date.now() + body.nextAttemptInMs);
      if (body.settleSignature !== undefined) patch.settleSignature = body.settleSignature;
      if (body.brokerStatus !== undefined) patch.brokerStatus = body.brokerStatus;
      await m.update(Order, { userPubkey: user, orderId }, patch);
      await m.insert(OrderEvent, <any>{ userPubkey: user, orderId, fromStatus: order.status, toStatus: patch.status ?? order.status, reason: 'scenario_drift_injected', details: body, actor: 'api:chaos' });
    });
    return this.orders.get(user, orderId);
  }

  /** Proxy to the mock broker admin surface, so the web app needs one base URL. */
  @UseGuards(AdminGuard)
  @Post('mock/faults')
  async faults(@Body() body: Record<string, unknown>) {
    return (await httpJson(`${this.env.MOCK_BROKER_URL}/admin/faults`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  }

  @Get('mock/state')
  async mockState() {
    return (await httpJson(`${this.env.MOCK_BROKER_URL}/admin/state`)).json();
  }

  @UseGuards(AdminGuard)
  @Post('mock/orders/:id/fill')
  async mockFill(@Param('id') id: string) {
    return (await httpJson(`${this.env.MOCK_BROKER_URL}/admin/orders/${id}/fill`, { method: 'POST' })).json();
  }

  @UseGuards(AdminGuard)
  @Post('mock/orders/:id/reject')
  async mockReject(@Param('id') id: string) {
    return (await httpJson(`${this.env.MOCK_BROKER_URL}/admin/orders/${id}/reject`, { method: 'POST' })).json();
  }
}
