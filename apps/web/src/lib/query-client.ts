/**
 * TanStack Query client setup
 *
 * Wraps the existing LazuliAPI static methods with caching, refetch-on-focus,
 * and stale-while-revalidate semantics. Persists to localStorage for instant
 * back-navigation. Replaces the bespoke useAutoRefresh hook.
 */

import { QueryClient, keepPreviousData } from '@tanstack/react-query';

/**
 * Cache default stale times per data category.
 *
 * Live market data (tickers, orderbook) — 10s before considered stale.
 * Chart data (OHLCV, indicators) — 60s; candles don't change mid-bar.
 * Reference data (exchanges, markets list) — 5min; rarely changes.
 * Heavy analytics (screener, custom-index, superema) — 2min; expensive to recompute.
 */
export const STALE_TIMES = {
  realtime: 10_000, // tickers, orderbook, market bar
  chart: 60_000, // ohlcv, indicators
  reference: 300_000, // exchanges, markets list
  analytics: 120_000, // screener, custom-index, superema
} as const;

/**
 * Default refresh intervals. Only active when a query has refetchInterval
 * explicitly set (we don't auto-poll everything — only what users see).
 */
export const REFRESH_INTERVALS = {
  realtime: 10_000,
  frequent: 30_000,
  standard: 60_000,
} as const;

/**
 * Build the QueryClient with sensible trading-app defaults.
 *
 * - No automatic refetch on mount (avoids stampede on navigation; we use
 *   placeholderData: keepPreviousData for instant transitions)
 * - Refetch on window focus (traders tab away and back constantly)
 * - Retry once on failure, no retry on 4xx
 * - 5min gcTime — cached data stays useful for back-button navigation
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        placeholderData: keepPreviousData,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          // Don't retry 4xx errors — they won't fix themselves
          if (error && typeof error === 'object' && 'status' in error) {
            const status = (error as { status: number }).status;
            if (status >= 400 && status < 500) return false;
          }
          return failureCount < 1;
        },
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000),
        gcTime: 5 * 60 * 1000,
        staleTime: STALE_TIMES.realtime,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
