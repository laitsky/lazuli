/**
 * TanStack Query hooks for all Lazuli data.
 *
 * Wraps LazuliAPI static methods with caching, dedup, and stale-while-revalidate.
 * Pages and components consume these hooks instead of calling LazuliAPI directly —
 * this gives us free background refresh, instant back-nav from cache, and
 * centralized error handling.
 *
 * Query keys are structured as nested arrays so partial invalidation works:
 *   ['tickers'] — invalidate everything ticker-related
 *   ['tickers', exchange] — invalidate one exchange's tickers
 *   ['tickers', exchange, { type, quote, search, sort, dir, page }] — exact match
 */

import {
  useQuery,
  useInfiniteQuery,
  useSuspenseQuery,
  keepPreviousData,
} from '@tanstack/react-query';
import {
  LazuliAPI,
  type TickersQueryParams,
  type MarketsQueryParams,
  type OHLCVQueryParams,
  type MultiTimeframeOHLCVQueryParams,
  type CustomPairQueryParams,
  type CustomIndexRequest,
  type SuperEMAQueryParams,
  type AltScreenerQueryParams,
  type FundingRateQueryParams,
  type CrossExchangeFundingQueryParams,
  type TechnicalIndicatorQueryParams,
  type OrderBookQueryParams,
  type PriceArbitrageQueryParams,
} from '@/lib/api-client';
import { STALE_TIMES } from '@/lib/query-client';

/* ============================================================
   Query key factory — colocated keys for type-safety
   ============================================================ */

export const queryKeys = {
  exchanges: ['exchanges'] as const,
  health: ['health'] as const,

  tickers: {
    all: ['tickers'] as const,
    list: (exchange: string, params: TickersQueryParams) =>
      ['tickers', 'list', exchange, params] as const,
    detail: (exchange: string, symbol: string) => ['tickers', 'detail', exchange, symbol] as const,
  },

  markets: {
    all: ['markets'] as const,
    list: (exchange: string, params: MarketsQueryParams) =>
      ['markets', 'list', exchange, params] as const,
  },

  ohlcv: {
    all: ['ohlcv'] as const,
    detail: (exchange: string, symbol: string, params: OHLCVQueryParams) =>
      ['ohlcv', exchange, symbol, params] as const,
    multi: (exchange: string, symbol: string, params: MultiTimeframeOHLCVQueryParams) =>
      ['ohlcv', 'multi', exchange, symbol, params] as const,
    batch: (exchange: string, symbols: string[], period: string) =>
      ['ohlcv', 'batch', exchange, symbols, period] as const,
  },

  indicators: {
    detail: (exchange: string, symbol: string, params: TechnicalIndicatorQueryParams) =>
      ['indicators', exchange, symbol, params] as const,
  },

  superEma: {
    detail: (exchange: string, symbol: string, params: SuperEMAQueryParams) =>
      ['superema', exchange, symbol, params] as const,
  },

  customPair: {
    detail: (exchange: string, symbol1: string, symbol2: string, params: CustomPairQueryParams) =>
      ['custom-pair', exchange, symbol1, symbol2, params] as const,
  },

  customIndex: {
    detail: (request: CustomIndexRequest) => ['custom-index', request] as const,
  },

  screener: {
    stats: (exchange: string) => ['screener', 'stats', exchange] as const,
    detail: (exchange: string, params: AltScreenerQueryParams) =>
      ['screener', 'detail', exchange, params] as const,
  },

  funding: {
    detail: (exchange: string, params: FundingRateQueryParams) =>
      ['funding', exchange, params] as const,
    compare: (params: CrossExchangeFundingQueryParams) => ['funding', 'compare', params] as const,
  },

  orderbook: {
    detail: (exchange: string, symbol: string, params: OrderBookQueryParams) =>
      ['orderbook', exchange, symbol, params] as const,
  },

  arbitrage: {
    prices: (params: PriceArbitrageQueryParams) => ['arbitrage', 'prices', params] as const,
  },
};

/* ============================================================
   Reference data — rarely changes
   ============================================================ */

export function useExchanges() {
  return useQuery({
    queryKey: queryKeys.exchanges,
    queryFn: async () => {
      const res = await LazuliAPI.getExchanges();
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed to load exchanges');
      return { data: res.data, meta: res.meta };
    },
    staleTime: STALE_TIMES.reference,
  });
}

export function useHealth(refreshMs = 30_000) {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: async () => {
      const res = await LazuliAPI.getHealth();
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed health check');
      return res.data;
    },
    staleTime: refreshMs / 2,
    refetchInterval: refreshMs,
    refetchIntervalInBackground: false,
  });
}

/* ============================================================
   Markets — list + detail
   ============================================================ */

export function useTickers(exchange: string, params: TickersQueryParams) {
  return useQuery({
    queryKey: queryKeys.tickers.list(exchange, params),
    queryFn: async () => {
      const res = await LazuliAPI.getTickers(
        exchange as Parameters<typeof LazuliAPI.getTickers>[0],
        params
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed to load tickers');
      return { data: res.data, meta: res.meta };
    },
    staleTime: STALE_TIMES.realtime,
    placeholderData: keepPreviousData,
  });
}

export function useTicker(exchange: string, symbol: string) {
  return useQuery({
    queryKey: queryKeys.tickers.detail(exchange, symbol),
    queryFn: async () => {
      const res = await LazuliAPI.getTicker(
        exchange as Parameters<typeof LazuliAPI.getTicker>[0],
        symbol
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Ticker not found');
      return { data: res.data, meta: res.meta };
    },
    staleTime: STALE_TIMES.realtime,
  });
}

/**
 * Auto-paginating ticker loader. Fetches all pages up-front for an exchange
 * so client-side sort/filter works on the full dataset. Use only when the
 * exchange's ticker count is reasonable (<2000).
 */
export function useAllTickers(
  exchange: string,
  baseParams: Omit<TickersQueryParams, 'page' | 'limit'> = {},
  options: { enabled?: boolean } = {}
) {
  return useInfiniteQuery({
    queryKey: ['tickers', 'all', exchange, baseParams] as const,
    queryFn: async ({ pageParam }) => {
      const res = await LazuliAPI.getTickers(
        exchange as Parameters<typeof LazuliAPI.getTickers>[0],
        { ...baseParams, page: pageParam, limit: 500 }
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed tickers');
      return { data: res.data, meta: res.meta };
    },
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.data.pagination?.hasNext ? (last.data.pagination.page ?? 1) + 1 : undefined,
    staleTime: STALE_TIMES.realtime,
    enabled: options.enabled ?? true,
  });
}

export function useMarkets(exchange: string, params: MarketsQueryParams) {
  return useQuery({
    queryKey: queryKeys.markets.list(exchange, params),
    queryFn: async () => {
      const res = await LazuliAPI.getMarkets(
        exchange as Parameters<typeof LazuliAPI.getMarkets>[0],
        params
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed to load markets');
      return res.data;
    },
    staleTime: STALE_TIMES.reference,
  });
}

/* ============================================================
   Charts — OHLCV, multi-timeframe, indicators
   ============================================================ */

export function useOhlcv(exchange: string, symbol: string, params: OHLCVQueryParams) {
  return useQuery({
    queryKey: queryKeys.ohlcv.detail(exchange, symbol, params),
    queryFn: async () => {
      const res = await LazuliAPI.getOHLCV(
        exchange as Parameters<typeof LazuliAPI.getOHLCV>[0],
        symbol,
        params
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed to load OHLCV');
      return { data: res.data, meta: res.meta };
    },
    staleTime: STALE_TIMES.chart,
    placeholderData: keepPreviousData,
  });
}

export function useMultiTimeframeOhlcv(
  exchange: string,
  symbol: string,
  params: MultiTimeframeOHLCVQueryParams
) {
  return useQuery({
    queryKey: queryKeys.ohlcv.multi(exchange, symbol, params),
    queryFn: async () => {
      const res = await LazuliAPI.getMultiTimeframeOHLCV(
        exchange as Parameters<typeof LazuliAPI.getMultiTimeframeOHLCV>[0],
        symbol,
        params
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed multi-timeframe');
      return { data: res.data, meta: res.meta };
    },
    staleTime: STALE_TIMES.chart,
  });
}

export function useOhlcvBatch(
  exchange: string,
  symbols: string[],
  period: string,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: queryKeys.ohlcv.batch(exchange, symbols, period),
    queryFn: async () => {
      const res = await LazuliAPI.getOhlcvBatch(
        exchange as Parameters<typeof LazuliAPI.getOhlcvBatch>[0],
        symbols,
        period
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed batch OHLCV');
      return res.data;
    },
    staleTime: STALE_TIMES.chart,
    enabled: (options.enabled ?? true) && symbols.length > 0,
  });
}

export function useTechnicalIndicators(
  exchange: string,
  symbol: string,
  params: TechnicalIndicatorQueryParams
) {
  return useQuery({
    queryKey: queryKeys.indicators.detail(exchange, symbol, params),
    queryFn: async () => {
      const res = await LazuliAPI.getTechnicalIndicators(
        exchange as Parameters<typeof LazuliAPI.getTechnicalIndicators>[0],
        symbol,
        params
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed indicators');
      return res.data;
    },
    staleTime: STALE_TIMES.chart,
  });
}

export function useSuperEma(exchange: string, symbol: string, params: SuperEMAQueryParams) {
  return useQuery({
    queryKey: queryKeys.superEma.detail(exchange, symbol, params),
    queryFn: async () => {
      const res = await LazuliAPI.getSuperEMA(
        exchange as Parameters<typeof LazuliAPI.getSuperEMA>[0],
        symbol,
        params
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed SuperEMA');
      return res.data;
    },
    staleTime: STALE_TIMES.analytics,
  });
}

/* ============================================================
   Custom analytics — synthetic pairs, custom index
   ============================================================ */

export function useCustomPair(
  exchange: string,
  symbol1: string,
  symbol2: string,
  params: CustomPairQueryParams,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: queryKeys.customPair.detail(exchange, symbol1, symbol2, params),
    queryFn: async () => {
      const res = await LazuliAPI.getCustomPair(
        exchange as Parameters<typeof LazuliAPI.getCustomPair>[0],
        symbol1,
        symbol2,
        params
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed custom pair');
      return res.data;
    },
    staleTime: STALE_TIMES.analytics,
    enabled: (options.enabled ?? true) && !!symbol1 && !!symbol2,
  });
}

export function useCustomIndex(request: CustomIndexRequest, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.customIndex.detail(request),
    queryFn: async () => {
      const res = await LazuliAPI.calculateCustomIndex(request);
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed custom index');
      return res.data;
    },
    staleTime: STALE_TIMES.analytics,
    enabled: options.enabled ?? true,
  });
}

/* ============================================================
   Screener
   ============================================================ */

export function useScreenerStats(exchange: string) {
  return useQuery({
    queryKey: queryKeys.screener.stats(exchange),
    queryFn: async () => {
      const res = await LazuliAPI.getAltScreenerStats(
        exchange as Parameters<typeof LazuliAPI.getAltScreenerStats>[0]
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed screener stats');
      return res.data;
    },
    staleTime: STALE_TIMES.analytics,
  });
}

export function useScreener(exchange: string, params: AltScreenerQueryParams) {
  return useQuery({
    queryKey: queryKeys.screener.detail(exchange, params),
    queryFn: async () => {
      const res = await LazuliAPI.getAltScreener(
        exchange as Parameters<typeof LazuliAPI.getAltScreener>[0],
        params
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed screener');
      return res.data;
    },
    staleTime: STALE_TIMES.analytics,
    placeholderData: keepPreviousData,
  });
}

/* ============================================================
   Funding & arbitrage
   ============================================================ */

export function useFundingRates(exchange: string, params: FundingRateQueryParams) {
  return useQuery({
    queryKey: queryKeys.funding.detail(exchange, params),
    queryFn: async () => {
      const res = await LazuliAPI.getFundingRates(
        exchange as Parameters<typeof LazuliAPI.getFundingRates>[0],
        params
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed funding rates');
      return { data: res.data, meta: res.meta };
    },
    staleTime: STALE_TIMES.realtime,
  });
}

export function useCrossExchangeFunding(params: CrossExchangeFundingQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.funding.compare(params),
    queryFn: async () => {
      const res = await LazuliAPI.getCrossExchangeFunding(params);
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed cross-exchange funding');
      return res.data;
    },
    staleTime: STALE_TIMES.realtime,
  });
}

export function useOrderBook(
  exchange: string,
  symbol: string,
  params: OrderBookQueryParams = {},
  options: { enabled?: boolean; refreshMs?: number } = {}
) {
  return useQuery({
    queryKey: queryKeys.orderbook.detail(exchange, symbol, params),
    queryFn: async () => {
      const res = await LazuliAPI.getOrderBook(
        exchange as Parameters<typeof LazuliAPI.getOrderBook>[0],
        symbol,
        params
      );
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed order book');
      return { data: res.data, meta: res.meta };
    },
    staleTime: STALE_TIMES.realtime,
    refetchInterval: options.refreshMs,
    enabled: (options.enabled ?? true) && !!symbol,
  });
}

export function usePriceArbitrage(params: PriceArbitrageQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.arbitrage.prices(params),
    queryFn: async () => {
      const res = await LazuliAPI.getPriceArbitrage(params);
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed price arbitrage');
      return { data: res.data, meta: res.meta };
    },
    staleTime: STALE_TIMES.realtime,
  });
}

/* ============================================================
   Suspense variants — for pages that want to suspend on first load
   ============================================================ */

export function useExchangesSuspense() {
  return useSuspenseQuery({
    queryKey: queryKeys.exchanges,
    queryFn: async () => {
      const res = await LazuliAPI.getExchanges();
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed exchanges');
      return res.data;
    },
    staleTime: STALE_TIMES.reference,
  });
}

/* ============================================================
   Topbar market bar — small fixed symbol set
   ============================================================ */

const TOPBAR_SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'] as const;

export function useTopbarPrices(exchange = 'bybit') {
  return useQuery({
    queryKey: ['topbar', 'prices', exchange, [...TOPBAR_SYMBOLS]] as const,
    queryFn: async () => {
      // Fetch all three in parallel
      const results = await Promise.all(
        TOPBAR_SYMBOLS.map(async (sym) => {
          const res = await LazuliAPI.getTicker(
            exchange as Parameters<typeof LazuliAPI.getTicker>[0],
            sym
          );
          return { symbol: sym, ticker: res.success ? res.data : null };
        })
      );
      return results;
    },
    staleTime: STALE_TIMES.realtime,
    refetchInterval: STALE_TIMES.realtime,
    refetchIntervalInBackground: false,
  });
}
