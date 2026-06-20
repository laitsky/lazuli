/**
 * RateLimiterDO
 *
 * A small token-bucket coordinator for exchange calls. Workers can scale out
 * globally, while exchange rate limits are account/IP scoped. Routing all hot
 * exchange acquisition through one Durable Object per exchange gives us a
 * single authority without external Redis.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

interface BucketState {
  tokens: number;
  updatedAt: number;
}

const DEFAULT_CAPACITY = 20;
const DEFAULT_REFILL_PER_SECOND = 10;

export class RateLimiterDO extends DurableObject<Env> {
  /**
   * HTTP API:
   * - GET/POST /acquire?cost=1&capacity=20&refillPerSecond=10
   *
   * Returns 200 when a token is granted, or 429 with retryAfterMs when callers
   * should back off. This intentionally avoids sleeping inside the DO so queue
   * consumers and public handlers can choose their own retry behavior.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cost = clamp(Number(url.searchParams.get('cost') ?? 1), 1, 100);
    const capacity = clamp(Number(url.searchParams.get('capacity') ?? DEFAULT_CAPACITY), 1, 10_000);
    const refillPerSecond = clamp(
      Number(url.searchParams.get('refillPerSecond') ?? DEFAULT_REFILL_PER_SECOND),
      0.1,
      10_000
    );

    const now = Date.now();
    const stored = (await this.ctx.storage.get<BucketState>('bucket')) ?? {
      tokens: capacity,
      updatedAt: now,
    };
    const elapsedSeconds = Math.max(0, (now - stored.updatedAt) / 1000);
    const tokens = Math.min(capacity, stored.tokens + elapsedSeconds * refillPerSecond);

    if (tokens < cost) {
      const retryAfterMs = Math.ceil(((cost - tokens) / refillPerSecond) * 1000);
      await this.ctx.storage.put<BucketState>('bucket', { tokens, updatedAt: now });
      return Response.json(
        {
          success: false,
          data: { granted: false, retryAfterMs },
          error: 'Rate limit token unavailable',
          timestamp: now,
        },
        { status: 429 }
      );
    }

    const remaining = tokens - cost;
    await this.ctx.storage.put<BucketState>('bucket', { tokens: remaining, updatedAt: now });
    return Response.json({
      success: true,
      data: { granted: true, remaining },
      error: null,
      timestamp: now,
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
