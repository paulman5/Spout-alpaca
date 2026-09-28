import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../config/env';

/**
 * Protects operational and chaos endpoints (pause/resume, drift, replay, mock faults).
 * Open when ADMIN_TOKEN is empty (local development); when set, the caller must send
 * `x-admin-token: <token>` or `Authorization: Bearer <token>`.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.env.ADMIN_TOKEN) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.header('x-admin-token') ?? req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (header === this.env.ADMIN_TOKEN) return true;
    throw new UnauthorizedException('admin token required');
  }
}
