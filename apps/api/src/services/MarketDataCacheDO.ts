/**
 * MarketDataCacheDO
 *
 * A demand-warmed live market cache. API Workers route reads to one Durable
 * Object shard per exchange/market type/resource, which keeps request paths
 * fast and prevents every user request from fanning out to exchanges.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { ccxtService } from './ccxtService';

type CacheResource = 'tickers' | 'markets' | 'funding';

interface CachedEnvelope<T> {
  data: T;
  updatedAt: number;
  source: 'exchange' | 'stale-cache';
  stale: boolean;
  error?: string;
}

interface ActiveKey {
  resource: CacheResource;
  exchange: string;
  type?: 'spot' | 'perp';
}

const TICKER_TTL_MS = 5_000;
const FUNDING_TTL_MS = 5_000;
const MARKET_TTL_MS = 60 * 60 * 1000;
const ACTIVE_KEYS = 'active-keys';
const MAX_STORAGE_VALUE_BYTES = 120_000;

export class MarketDataCacheDO extends DurableObject<Env> {
  private readonly memoryCache = new Map<string, CachedEnvelope<unknown>>();

  /**
   * HTTP API:
   * - GET /tickers?exchange=binance&type=spot
   * - GET /markets?exchange=binance&type=perp
   * - GET /funding?exchange=binance
   * - GET /health
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const resource = url.pathname.replace('/', '') as CacheResource | 'health';

    if (resource === 'health') {
      return Response.json({
        ok: true,
        activeKeys: ((await this.ctx.storage.get<ActiveKey[]>(ACTIVE_KEYS)) ?? []).length,
        alarm: await this.ctx.storage.getAlarm(),
        timestamp: Date.now(),
      });
    }

    if (resource !== 'tickers' && resource !== 'markets' && resource !== 'funding') {
      return Response.json({ error: 'Unknown cache resource' }, { status: 404 });
    }

    const exchange = url.searchParams.get('exchange') ?? '';
    const rawType = url.searchParams.get('type');
    const type = rawType === 'spot' || rawType === 'perp' ? rawType : undefined;

    if (!exchange) {
      return Response.json({ error: 'Missing exchange' }, { status: 400 });
    }

    const key: ActiveKey = { resource, exchange, type };
    await this.rememberKey(key);
    await this.ensureAlarm();

    const cached = await this.readOrRefresh(key);
    return Response.json({
      success: true,
      data: cached.data,
      error: null,
      timestamp: Date.now(),
      meta: {
        source: cached.source,
        cacheAgeMs: Date.now() - cached.updatedAt,
        stale: cached.stale,
        exchange,
        type,
        resource,
        refreshError: cached.error,
      },
    });
  }

  /**
   * Alarm refreshes only keys that have been requested recently. This keeps the
   * five-second cache hot for real traffic while avoiding a global infinite
   * poll across every possible symbol and exchange.
   */
  async alarm(): Promise<void> {
    const keys = (await this.ctx.storage.get<ActiveKey[]>(ACTIVE_KEYS)) ?? [];
    const startedAt = Date.now();

    for (const key of keys) {
      try {
        await this.refresh(key);
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            module: 'MarketDataCacheDO',
            msg: 'alarm refresh failed',
            key,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }

    if (keys.length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + TICKER_TTL_MS);
    }

    console.log(
      JSON.stringify({
        level: 'info',
        module: 'MarketDataCacheDO',
        msg: 'alarm refresh complete',
        keys: keys.length,
        durationMs: Date.now() - startedAt,
      })
    );
  }

  private async readOrRefresh(key: ActiveKey): Promise<CachedEnvelope<unknown>> {
    const cacheKey = this.cacheKey(key);
    const memoryCached = this.memoryCache.get(cacheKey);
    const cached = await this.ctx.storage.get<CachedEnvelope<unknown>>(cacheKey);
    const now = Date.now();

    if (memoryCached && now - memoryCached.updatedAt <= this.ttlFor(key.resource)) {
      return memoryCached;
    }

    if (cached && now - cached.updatedAt <= this.ttlFor(key.resource)) {
      this.memoryCache.set(cacheKey, cached);
      return cached;
    }

    try {
      return await this.refresh(key);
    } catch (error) {
      const staleFallback = cached ?? memoryCached;
      if (staleFallback) {
        const stale: CachedEnvelope<unknown> = {
          ...staleFallback,
          source: 'stale-cache',
          stale: true,
          error: error instanceof Error ? error.message : String(error),
        };
        await this.writeCache(cacheKey, stale);
        return stale;
      }
      throw error;
    }
  }

  private async refresh(key: ActiveKey): Promise<CachedEnvelope<unknown>> {
    const data = await this.fetchResource(key);
    const envelope: CachedEnvelope<unknown> = {
      data,
      updatedAt: Date.now(),
      source: 'exchange',
      stale: false,
    };
    await this.writeCache(this.cacheKey(key), envelope);
    return envelope;
  }

  private async writeCache(cacheKey: string, envelope: CachedEnvelope<unknown>): Promise<void> {
    this.memoryCache.set(cacheKey, envelope);

    const serializedSize = new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
    if (serializedSize > MAX_STORAGE_VALUE_BYTES) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          module: 'MarketDataCacheDO',
          msg: 'cache payload kept in memory because it exceeds durable storage value limit',
          cacheKey,
          serializedSize,
        })
      );
      return;
    }

    await this.ctx.storage.put(cacheKey, envelope);
  }

  private async fetchResource(key: ActiveKey): Promise<unknown> {
    if (key.resource === 'tickers') {
      const tickers = await ccxtService.getAllTickers(key.exchange);
      return key.type ? tickers.filter((ticker) => ticker.type === key.type) : tickers;
    }

    if (key.resource === 'markets') {
      const markets = await ccxtService.getMarkets(key.exchange);
      return key.type ? markets.filter((market) => market.type === key.type) : markets;
    }

    return ccxtService.getFundingRates(key.exchange);
  }

  private async rememberKey(key: ActiveKey): Promise<void> {
    const keys = (await this.ctx.storage.get<ActiveKey[]>(ACTIVE_KEYS)) ?? [];
    const serialized = JSON.stringify(key);
    const next = [key, ...keys.filter((existing) => JSON.stringify(existing) !== serialized)].slice(
      0,
      100
    );
    await this.ctx.storage.put(ACTIVE_KEYS, next);
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + TICKER_TTL_MS);
    }
  }

  private cacheKey(key: ActiveKey): string {
    return `${key.resource}:${key.exchange}:${key.type ?? 'all'}`;
  }

  private ttlFor(resource: CacheResource): number {
    if (resource === 'markets') {
      return MARKET_TTL_MS;
    }
    if (resource === 'funding') {
      return FUNDING_TTL_MS;
    }
    return TICKER_TTL_MS;
  }
}
