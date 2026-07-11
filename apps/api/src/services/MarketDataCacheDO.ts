import { DurableObject } from 'cloudflare:workers';
import type { InstitutionalAsset, InstitutionalRange, Timeframe } from '@lazuli/shared';
import type { Env } from '../types';
import { ccxtService } from './ccxtService';
import { getOptionsChain, getOptionsExpiries, getOptionsVolatility } from './institutionalService';
import { BoundedMemoryCache, type MemoryCachePolicy } from './memoryCache';

type CacheResource = 'tickers' | 'markets' | 'funding' | 'ohlcv' | 'orderbook' | 'institutional';
type InstitutionalCacheKind = 'options-chain' | 'options-expiries' | 'options-volatility';

interface CacheRequest {
  resource: CacheResource;
  exchange: string;
  type?: 'spot' | 'perp';
  symbol?: string;
  timeframe?: Timeframe;
  limit: number;
  institutionalKind?: InstitutionalCacheKind;
  asset?: InstitutionalAsset;
  range?: InstitutionalRange;
  expiry?: string;
}

const MAX_CACHE_BYTES = 48 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 128;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

const POLICIES: Record<Exclude<CacheResource, 'ohlcv'>, MemoryCachePolicy> = {
  tickers: { ttlMs: 15_000, staleTtlMs: 5 * 60_000 },
  orderbook: { ttlMs: 5_000, staleTtlMs: 30_000 },
  funding: { ttlMs: 60_000, staleTtlMs: 10 * 60_000 },
  markets: { ttlMs: 6 * 60 * 60_000, staleTtlMs: 24 * 60 * 60_000 },
  institutional: { ttlMs: 5 * 60_000, staleTtlMs: 30 * 60_000 },
};

export class MarketDataCacheV2DO extends DurableObject<Env> {
  private readonly cache = new BoundedMemoryCache({
    maxEntries: MAX_CACHE_ENTRIES,
    maxBytes: MAX_CACHE_BYTES,
    maxEntryBytes: MAX_ENTRY_BYTES,
  });

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, timestamp: Date.now() });
    }

    const parsed = parseCacheRequest(url);
    if (parsed instanceof Response) return parsed;

    const key = cacheKey(parsed);
    try {
      const result = await this.cache.getOrLoad(key, policyFor(parsed), () =>
        this.fetchResource(parsed)
      );
      return Response.json({
        data: result.value,
        meta: {
          source:
            result.state === 'hit'
              ? 'memory'
              : result.state === 'stale'
                ? 'stale-memory'
                : 'exchange',
          cache: result.state,
          ageMs: result.ageMs,
          stale: result.state === 'stale',
          retained: result.stored,
          ...(result.refreshError ? { refreshError: result.refreshError } : {}),
        },
      });
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : String(error),
          resource: parsed.resource,
          exchange: parsed.exchange,
          timestamp: Date.now(),
        },
        { status: 503 }
      );
    }
  }

  private async fetchResource(request: CacheRequest): Promise<unknown> {
    switch (request.resource) {
      case 'tickers': {
        const tickers = await ccxtService.getAllTickers(request.exchange);
        return request.type ? tickers.filter((ticker) => ticker.type === request.type) : tickers;
      }
      case 'markets': {
        const markets = await ccxtService.getMarkets(request.exchange);
        return request.type ? markets.filter((market) => market.type === request.type) : markets;
      }
      case 'funding':
        return ccxtService.getFundingRates(request.exchange);
      case 'ohlcv':
        return ccxtService.fetchOHLCV(
          request.exchange,
          request.symbol!,
          request.timeframe ?? '1h',
          request.type ?? 'spot',
          request.limit
        );
      case 'orderbook':
        return ccxtService.fetchOrderBook(
          request.exchange,
          request.symbol!,
          request.type ?? 'spot',
          request.limit
        );
      case 'institutional':
        return this.fetchInstitutional(request);
    }
  }

  private fetchInstitutional(request: CacheRequest): Promise<unknown> {
    const asset = request.asset ?? 'BTC';
    switch (request.institutionalKind) {
      case 'options-chain':
        return getOptionsChain(asset, request.expiry);
      case 'options-expiries':
        return getOptionsExpiries(asset);
      case 'options-volatility':
        return getOptionsVolatility(asset, request.range ?? '90d');
      default:
        throw new Error('Unsupported institutional resource');
    }
  }
}

function parseCacheRequest(url: URL): CacheRequest | Response {
  const resource = url.pathname.slice(1) as CacheResource;
  if (!isCacheResource(resource)) {
    return Response.json({ error: 'Unknown cache resource' }, { status: 404 });
  }

  const exchange = url.searchParams.get('exchange')?.trim().toLowerCase() ?? '';
  const type = parseMarketType(url.searchParams.get('type'));
  const symbol = url.searchParams.get('symbol')?.trim() || undefined;
  const timeframe = parseTimeframe(url.searchParams.get('timeframe'));
  const institutionalKind = parseInstitutionalKind(url.searchParams.get('kind'));
  const asset = parseInstitutionalAsset(url.searchParams.get('asset'));
  const range = parseInstitutionalRange(url.searchParams.get('range'));
  const expiry = url.searchParams.get('expiry')?.trim() || undefined;
  const limit = clampInteger(url.searchParams.get('limit'), 100, 1, 1000);

  if (resource !== 'institutional' && !exchange) {
    return Response.json({ error: 'Missing exchange' }, { status: 400 });
  }
  if ((resource === 'ohlcv' || resource === 'orderbook') && !symbol) {
    return Response.json({ error: 'Missing symbol' }, { status: 400 });
  }
  if (resource === 'institutional' && !institutionalKind) {
    return Response.json({ error: 'Missing institutional kind' }, { status: 400 });
  }

  return {
    resource,
    exchange: exchange || 'institutional',
    type,
    symbol,
    timeframe,
    limit,
    institutionalKind,
    asset,
    range,
    expiry,
  };
}

function policyFor(request: CacheRequest): MemoryCachePolicy {
  if (request.resource !== 'ohlcv') return POLICIES[request.resource];

  const ttlMs = request.timeframe === '1m' ? 15_000 : request.timeframe === '5m' ? 30_000 : 60_000;
  return { ttlMs, staleTtlMs: 30 * 60_000 };
}

function cacheKey(request: CacheRequest): string {
  return JSON.stringify(request);
}

function isCacheResource(value: string): value is CacheResource {
  return (
    value === 'tickers' ||
    value === 'markets' ||
    value === 'funding' ||
    value === 'ohlcv' ||
    value === 'orderbook' ||
    value === 'institutional'
  );
}

function parseMarketType(value: string | null): 'spot' | 'perp' | undefined {
  return value === 'spot' || value === 'perp' ? value : undefined;
}

function parseTimeframe(value: string | null): Timeframe | undefined {
  return value === '1m' ||
    value === '5m' ||
    value === '15m' ||
    value === '1h' ||
    value === '4h' ||
    value === '1d' ||
    value === '3d' ||
    value === '1w'
    ? value
    : undefined;
}

function parseInstitutionalKind(value: string | null): InstitutionalCacheKind | undefined {
  return value === 'options-chain' || value === 'options-expiries' || value === 'options-volatility'
    ? value
    : undefined;
}

function parseInstitutionalAsset(value: string | null): InstitutionalAsset | undefined {
  return value === 'BTC' || value === 'ETH' ? value : undefined;
}

function parseInstitutionalRange(value: string | null): InstitutionalRange | undefined {
  return value === '30d' || value === '90d' || value === 'ytd' || value === 'all'
    ? value
    : undefined;
}

function clampInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
