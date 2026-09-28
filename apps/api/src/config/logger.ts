import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from './env';

export function pinoModule() {
  const env = loadEnv();
  const pretty = process.stdout.isTTY || process.env['LOG_PRETTY'] === '1';
  return LoggerModule.forRoot({
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { role: env.ROLE, worker: env.WORKER_ID },
      autoLogging: false,
      transport: pretty
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } }
        : undefined,
    },
  });
}
