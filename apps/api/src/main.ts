import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadEnv } from './config/env';
import { AppModule } from './app.module';
import { MockBrokerAppModule } from './mock-broker/mock-broker.module';

// A stray rejection (e.g. web3.js' internal confirmation poller giving up after RPC 429s)
// must never take a worker down: the order stays leased until the lease expires, then it is
// retried like any other transient failure. Log loudly, keep running.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledRejection]', reason instanceof Error ? `${reason.name}: ${reason.message}` : reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[uncaughtException]', err);
});

async function bootstrap() {
  const env = loadEnv();

  if (env.ROLE === 'mock-broker') {
    const app = await NestFactory.create(MockBrokerAppModule, { bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.enableShutdownHooks();
    await app.listen(env.MOCK_BROKER_PORT, '::');
    app.get(Logger).log(`mock broker listening on :${env.MOCK_BROKER_PORT}`);
    return;
  }

  if (env.ROLE === 'api') {
    const app = await NestFactory.create(AppModule.forRole(), { bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.enableCors({ origin: true });
    app.enableShutdownHooks();
    await app.listen(env.PORT, '::');
    app.get(Logger).log(`api listening on :${env.PORT}`);
    return;
  }

  // listener | worker | reconciler: headless processes
  const app = await NestFactory.createApplicationContext(AppModule.forRole(), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.init();

  // Tiny liveness endpoint so a platform (Railway, k8s, compose healthcheck) can probe headless roles.
  if (env.HEALTH_PORT > 0) {
    const started = Date.now();
    createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, role: env.ROLE, worker: env.WORKER_ID ?? null, uptimeSec: Math.round((Date.now() - started) / 1000) }));
      } else {
        res.writeHead(404).end();
      }
    }).listen(env.HEALTH_PORT, '::');
    app.get(Logger).log(`${env.ROLE} health endpoint on :${env.HEALTH_PORT}/health`);
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
