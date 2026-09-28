import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../src/app.module';

/** Boot a headless Nest context for scripts (uses ROLE from env; defaults to api). */
export async function bootCtx(role: 'api' | 'reconciler' = 'api'): Promise<INestApplicationContext> {
  process.env['ROLE'] = process.env['ROLE'] ?? role;
  process.env['RECONCILE_ONCE'] = process.env['RECONCILE_ONCE'] ?? 'false';
  const ctx = await NestFactory.createApplicationContext(AppModule.forRole(), { logger: ['error', 'warn'] });
  await ctx.init();
  return ctx;
}

// Node resolves `localhost` to ::1 first; Docker publishes ports on IPv4 only. Pin the loopback address.
const loopback = (u: string) => u.replace('//localhost', '//127.0.0.1');
export const API_URL = loopback(process.env['API_URL'] ?? 'http://localhost:4000');
export const MOCK_URL = loopback(process.env['MOCK_BROKER_URL'] ?? 'http://localhost:4010');

/** Mutating endpoints require the admin token when the target API sets ADMIN_TOKEN (hosted demo). */
const adminHeaders = (): Record<string, string> => (process.env['ADMIN_TOKEN'] ? { 'x-admin-token': process.env['ADMIN_TOKEN'] } : {});

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { 'Content-Type': 'application/json', ...adminHeaders() }, ...init });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function mock<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${MOCK_URL}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    // eslint-disable-next-line no-console
    console.error(`\n  ✗ ASSERTION FAILED: ${msg}\n`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${msg}`);
}

export function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
