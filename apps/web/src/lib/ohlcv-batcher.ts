import { LazuliAPI } from '@/lib/api-client';
import type { OHLCV, PerformancePeriod, SupportedExchange } from '@lazuli/shared';

// Server route caps at 50, but the API service processes OHLCV in batches of 25.
// Aligning client batches to 25 reduces burstiness and plays nicer with rate limits.
const MAX_BATCH_SIZE = 25;

// Small window to coalesce many "chart became visible" events into one request.
const FLUSH_DELAY_MS = 75;

// Cache tuning: server caches OHLCV for 3 minutes; keep a slightly shorter client TTL.
const SUCCESS_TTL_MS = 2 * 60 * 1000;
const EMPTY_TTL_MS = 30 * 1000;

// Prevent unbounded growth when scrolling/refreshing.
const MAX_CACHE_ENTRIES = 800;

// When draining a large queue, insert a small gap between successive requests.
const INTER_BATCH_DELAY_MS = 25;

type BatchKey = `${SupportedExchange}|${PerformancePeriod}`;
type CacheKey = `${BatchKey}|${string}`;

type CacheEntry = { ohlcv: OHLCV[]; expiresAt: number };

const cache = new Map<CacheKey, CacheEntry>();
const inflight = new Map<CacheKey, Promise<OHLCV[]>>();
const resolvers = new Map<
  CacheKey,
  { resolve: (ohlcv: OHLCV[]) => void; reject: (error: unknown) => void }
>();
const pendingSymbols = new Map<BatchKey, Set<string>>();
const timers = new Map<BatchKey, ReturnType<typeof setTimeout>>();
const isFlushing = new Set<BatchKey>();

function scheduleFlush(batchKey: BatchKey) {
  if (timers.has(batchKey)) return;
  timers.set(
    batchKey,
    setTimeout(() => {
      timers.delete(batchKey);
      void flushBatch(batchKey);
    }, FLUSH_DELAY_MS)
  );
}

function setCacheEntry(cacheKey: CacheKey, ohlcv: OHLCV[]) {
  const ttl = ohlcv.length > 0 ? SUCCESS_TTL_MS : EMPTY_TTL_MS;

  // Refresh insertion order (simple LRU-ish behavior)
  cache.delete(cacheKey);
  cache.set(cacheKey, { ohlcv, expiresAt: Date.now() + ttl });

  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as CacheKey | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function getCacheEntry(cacheKey: CacheKey): OHLCV[] | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    return null;
  }
  // Touch to keep hot entries
  cache.delete(cacheKey);
  cache.set(cacheKey, entry);
  return entry.ohlcv;
}

async function flushBatch(batchKey: BatchKey) {
  if (isFlushing.has(batchKey)) return;
  isFlushing.add(batchKey);

  try {
    while (true) {
      const queue = pendingSymbols.get(batchKey);
      if (!queue || queue.size === 0) return;

      const [exchange, period] = batchKey.split('|') as [SupportedExchange, PerformancePeriod];
      const symbols = Array.from(queue).slice(0, MAX_BATCH_SIZE);
      for (const symbol of symbols) queue.delete(symbol);

      if (queue.size === 0) pendingSymbols.delete(batchKey);

      try {
        const response = await LazuliAPI.getOhlcvBatch(exchange, symbols, period);
        if (!response.success || !response.data) {
          throw new Error(response.error || 'Failed to fetch OHLCV batch');
        }

        for (const symbol of symbols) {
          const key = `${batchKey}|${symbol}` as const;
          const ohlcv = response.data.ohlcv[symbol] ?? [];

          setCacheEntry(key, ohlcv);
          inflight.delete(key);
          const resolver = resolvers.get(key);
          resolvers.delete(key);
          resolver?.resolve(ohlcv);
        }
      } catch (error) {
        for (const symbol of symbols) {
          const key = `${batchKey}|${symbol}` as const;
          inflight.delete(key);
          const resolver = resolvers.get(key);
          resolvers.delete(key);
          resolver?.reject(error);
        }
      }

      // If more items are queued, add a small gap to reduce bursts.
      if (pendingSymbols.get(batchKey)?.size) {
        await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY_MS));
      }
    }
  } finally {
    isFlushing.delete(batchKey);
    // Handle edge case where symbols are queued while a flush is finishing
    if (pendingSymbols.get(batchKey)?.size) {
      scheduleFlush(batchKey);
    }
  }
}

export async function getOhlcvForSymbol(
  exchange: SupportedExchange,
  symbol: string,
  period: PerformancePeriod = '24h'
): Promise<OHLCV[]> {
  const batchKey = `${exchange}|${period}` as const;
  const cacheKey = `${batchKey}|${symbol}` as const;

  const cached = getCacheEntry(cacheKey);
  if (cached) return cached;

  const existingInflight = inflight.get(cacheKey);
  if (existingInflight) return existingInflight;

  const promise = new Promise<OHLCV[]>((resolve, reject) => {
    resolvers.set(cacheKey, { resolve, reject });
  });
  inflight.set(cacheKey, promise);

  const queue = pendingSymbols.get(batchKey) ?? new Set<string>();
  pendingSymbols.set(batchKey, queue);
  queue.add(symbol);

  if (queue.size >= MAX_BATCH_SIZE) {
    if (timers.has(batchKey)) {
      clearTimeout(timers.get(batchKey));
      timers.delete(batchKey);
    }
    void flushBatch(batchKey);
  } else {
    scheduleFlush(batchKey);
  }

  return promise;
}
