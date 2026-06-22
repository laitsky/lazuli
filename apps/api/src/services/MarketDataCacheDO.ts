/**
 * MarketDataCacheDO
 *
 * A demand-warmed live market cache. API Workers route reads to one Durable
 * Object shard per exchange/market type/resource, which keeps request paths
 * fast and prevents every user request from fanning out to exchanges.
 */

import { DurableObject } from 'cloudflare:workers';
import type { OHLCV, OrderBook, Timeframe } from '@lazuli/shared';
import type { Env } from '../types';
import { ccxtService } from './ccxtService';

type CacheResource = 'tickers' | 'markets' | 'funding' | 'ohlcv' | 'orderbook';

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
  symbol?: string;
  timeframe?: Timeframe;
  limit?: number;
}

const TICKER_TTL_MS = 5_000;
const FUNDING_TTL_MS = 5_000;
const OHLCV_TTL_MS = 15_000;
const ORDERBOOK_TTL_MS = 2_000;
const MARKET_TTL_MS = 60 * 60 * 1000;
const ACTIVE_KEYS = 'active-keys';
const MAX_STORAGE_VALUE_BYTES = 120_000;
const MAX_ACTIVE_KEYS = 100;
const MAX_MEMORY_KEYS = 150;

export class MarketDataCacheDO extends DurableObject<Env> {
  private readonly memoryCache = new Map<string, CachedEnvelope<unknown>>();

  /**
   * HTTP API:
   * - GET /tickers?exchange=binance&type=spot
   * - GET /markets?exchange=binance&type=perp
   * - GET /funding?exchange=binance
   * - GET /ohlcv?exchange=binance&symbol=BTC-USDT&type=spot&timeframe=1h&limit=100
   * - GET /orderbook?exchange=binance&symbol=BTC-USDT&type=spot&limit=50
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

    if (
      resource !== 'tickers' &&
      resource !== 'markets' &&
      resource !== 'funding' &&
      resource !== 'ohlcv' &&
      resource !== 'orderbook'
    ) {
      return Response.json({ error: 'Unknown cache resource' }, { status: 404 });
    }

    const exchange = url.searchParams.get('exchange') ?? '';
    const rawType = url.searchParams.get('type');
    const type = rawType === 'spot' || rawType === 'perp' ? rawType : undefined;
    const symbol = url.searchParams.get('symbol') ?? undefined;
    const timeframe = parseTimeframe(url.searchParams.get('timeframe'));
    const limit = clampInteger(url.searchParams.get('limit'), 100, 1, 1000);

    if (!exchange) {
      return Response.json({ error: 'Missing exchange' }, { status: 400 });
    }
    if ((resource === 'ohlcv' || resource === 'orderbook') && !symbol) {
      return Response.json({ error: 'Missing symbol' }, { status: 400 });
    }

    const key: ActiveKey = { resource, exchange, type, symbol, timeframe, limit };
    if (shouldBackgroundRefresh(resource)) {
      await this.rememberKey(key);
      await this.ensureAlarm();
    }

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
   * Alarm refreshes only exchange-level keys that have been requested recently.
   * High-cardinality OHLCV and orderbook keys are cached on demand and can serve
   * stale data on refresh errors, but they are not background-polled.
   */
  async alarm(): Promise<void> {
    const keys = (await this.ctx.storage.get<ActiveKey[]>(ACTIVE_KEYS)) ?? [];
    const startedAt = Date.now();

    const refreshableKeys = keys.filter((key) => shouldBackgroundRefresh(key.resource));

    for (const key of refreshableKeys) {
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

    if (refreshableKeys.length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + TICKER_TTL_MS);
    }

    console.log(
      JSON.stringify({
        level: 'info',
        module: 'MarketDataCacheDO',
        msg: 'alarm refresh complete',
        keys: refreshableKeys.length,
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
    while (this.memoryCache.size > MAX_MEMORY_KEYS) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (!oldestKey) break;
      this.memoryCache.delete(oldestKey);
    }

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

    if (key.resource === 'funding') {
      return ccxtService.getFundingRates(key.exchange);
    }

    if (key.resource === 'ohlcv') {
      return ccxtService.fetchOHLCV(
        key.exchange,
        key.symbol!,
        key.timeframe ?? '1h',
        key.type ?? inferMarketType(key.symbol!),
        key.limit ?? 100
      ) satisfies Promise<OHLCV[]>;
    }

    return ccxtService.fetchOrderBook(
      key.exchange,
      key.symbol!,
      key.type ?? inferMarketType(key.symbol!),
      Math.min(key.limit ?? 50, 500)
    ) satisfies Promise<OrderBook>;
  }

  private async rememberKey(key: ActiveKey): Promise<void> {
    const keys = (await this.ctx.storage.get<ActiveKey[]>(ACTIVE_KEYS)) ?? [];
    const serialized = JSON.stringify(key);
    const next = [key, ...keys.filter((existing) => JSON.stringify(existing) !== serialized)].slice(
      0,
      MAX_ACTIVE_KEYS
    );
    await this.ctx.storage.put(ACTIVE_KEYS, next);
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + TICKER_TTL_MS);
    }
  }

  private cacheKey(key: ActiveKey): string {
    return [
      key.resource,
      key.exchange,
      key.type ?? 'all',
      key.symbol ?? 'all',
      key.timeframe ?? 'na',
      key.limit ?? 'na',
    ].join(':');
  }

  private ttlFor(resource: CacheResource): number {
    if (resource === 'markets') {
      return MARKET_TTL_MS;
    }
    if (resource === 'funding') {
      return FUNDING_TTL_MS;
    }
    if (resource === 'ohlcv') {
      return OHLCV_TTL_MS;
    }
    if (resource === 'orderbook') {
      return ORDERBOOK_TTL_MS;
    }
    return TICKER_TTL_MS;
  }
}

function parseTimeframe(value: string | null): Timeframe | undefined {
  if (
    value === '1m' ||
    value === '5m' ||
    value === '15m' ||
    value === '1h' ||
    value === '4h' ||
    value === '1d' ||
    value === '3d' ||
    value === '1w'
  ) {
    return value;
  }
  return undefined;
}

function inferMarketType(symbol: string): 'spot' | 'perp' {
  return symbol.endsWith('.P') ? 'perp' : 'spot';
}

function shouldBackgroundRefresh(resource: CacheResource): boolean {
  return resource === 'tickers' || resource === 'markets' || resource === 'funding';
}

function clampInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
