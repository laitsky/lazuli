/**
 * Screener Service - Business logic for Alt Screener feature
 *
 * This service handles:
 * - Fetching all altcoins (excluding BTC) from exchanges
 * - Calculating performance relative to base currencies (USD/BTC/ETH/SOL)
 * - Fetching mini OHLCV data for sparkline charts
 * - Sorting and filtering altcoins
 * - Calculating aggregate statistics
 *
 * The Alt Screener helps traders identify promising altcoins by:
 * - Comparing all altcoins at once on a single page
 * - Showing performance relative to major assets (not just USD)
 * - Providing visual mini charts for quick pattern recognition
 */

import { ccxtService } from './ccxtService';
import { cacheService } from './cacheService';
import {
  Ticker,
  OHLCV,
  SupportedExchange,
  AltcoinPerformance,
  AltScreenerResponse,
  BaseCurrency,
  BaseCurrencyPrices,
  PerformancePeriod,
  ScreenerSortBy,
  ScreenerFilters,
  Timeframe,
} from '@lazuli/shared';
import { parseSymbol } from '../utils/validation';
import { isApiError } from '../errors';

/**
 * Base currency symbols for price comparison
 * Maps base currency type to the USDT trading pair symbol
 */
const BASE_CURRENCY_SYMBOLS: Record<BaseCurrency, string> = {
  USD: '', // No conversion needed for USD
  BTC: 'BTC-USDT',
  ETH: 'ETH-USDT',
  SOL: 'SOL-USDT',
};

/**
 * Excluded base currencies from altcoin list
 * These are used as comparison bases, not shown as altcoins
 */
const EXCLUDED_BASES = ['BTC', 'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD'];

/**
 * Timeframe mapping for performance periods
 * Maps performance period to OHLCV timeframe for chart data
 */
const PERIOD_TIMEFRAMES: Record<PerformancePeriod, Timeframe> = {
  '1h': '5m', // 12 candles for 1h
  '4h': '15m', // 16 candles for 4h
  '24h': '1h', // 24 candles for 24h
  '7d': '4h', // 42 candles for 7d
  '30d': '1d', // 30 candles for 30d
};

/**
 * Number of candles to fetch for each period
 */
const PERIOD_CANDLE_LIMITS: Record<PerformancePeriod, number> = {
  '1h': 12,
  '4h': 16,
  '24h': 24,
  '7d': 42,
  '30d': 30,
};

/**
 * Minutes per candle for each timeframe
 * Used to compute period changes from OHLCV arrays
 */
const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '3d': 4320,
  '1w': 10080,
};

/**
 * Performance optimization constants
 * Tuned for balance between speed and rate limit compliance
 */
const PERFORMANCE_CONFIG = {
  // Batch size for parallel OHLCV requests (increased from 10 for faster loading)
  BATCH_SIZE: 25,
  // Delay between batches in ms (reduced from 100ms)
  BATCH_DELAY_MS: 50,
  // Screener response cache TTL in ms
  // Set to 3 minutes to outlast the 2-minute worker warming interval
  // This ensures cache is always warm when worker pre-computes responses
  SCREENER_CACHE_TTL_MS: 180000, // 3 minutes (was 60s)
  // OHLCV data cache TTL in ms (increased from 60s - chart data doesn't change rapidly)
  OHLCV_CACHE_TTL_MS: 180000, // 3 minutes
  // Lightweight (no OHLCV) response cache TTL - shorter since it's faster to regenerate
  LIGHTWEIGHT_CACHE_TTL_MS: 30000, // 30 seconds
  // Ticker cache TTL in ms (align with MarketDataWorker)
  TICKER_CACHE_TTL_MS: 10000,
};

export class ScreenerService {
  /**
   * Get tickers from cache if available, otherwise fetch and populate cache
   */
  private async getTickersWithCache(exchangeId: SupportedExchange): Promise<Ticker[]> {
    const cacheKey = `tickers:${exchangeId}:raw`;
    const cached = await cacheService.getAsync<Ticker[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const tickers = await ccxtService.getAllTickers(exchangeId);
    cacheService.set(cacheKey, tickers, PERFORMANCE_CONFIG.TICKER_CACHE_TTL_MS);
    return tickers;
  }

  /**
   * Get all altcoins with performance data and mini charts
   *
   * This is the main method for the Alt Screener feature:
   * 1. Fetches all tickers from the exchange
   * 2. Filters to USDT pairs and excludes major coins (BTC, stablecoins)
   * 3. Fetches base currency price for relative calculations
   * 4. Calculates performance relative to selected base currency
   * 5. Fetches mini OHLCV data for sparkline charts
   * 6. Applies sorting and filtering
   *
   * @param exchangeId - Exchange to fetch from (binance, bybit, okx)
   * @param baseCurrency - Currency to compare against (USD, BTC, ETH, SOL)
   * @param period - Performance calculation period
   * @param sortBy - Field to sort by
   * @param sortOrder - Sort direction
   * @param limit - Maximum number of results
   * @param filters - Optional filters
   * @returns AltScreenerResponse with all altcoin data
   */
  async getAltcoins(
    exchangeId: SupportedExchange,
    baseCurrency: BaseCurrency = 'USD',
    period: PerformancePeriod = '24h',
    sortBy: ScreenerSortBy = 'performance',
    sortOrder: 'asc' | 'desc' = 'desc',
    limit: number = 100,
    filters?: ScreenerFilters
  ): Promise<AltScreenerResponse> {
    try {
      // Cache key no longer includes baseCurrency - we always return USD prices
      // and include all base currency prices for client-side switching
      const cacheKey = `screener:${exchangeId}:${period}`;
      const cachedResult = await cacheService.getAsync<AltScreenerResponse>(cacheKey);

      if (cachedResult) {
        // Apply sorting and filtering to cached results
        const normalizedResult: AltScreenerResponse = {
          ...cachedResult,
          baseCurrency,
          basePrice: cachedResult.basePrices?.[baseCurrency] ?? cachedResult.basePrice,
        };
        return this.applySortAndFilter(normalizedResult, sortBy, sortOrder, limit, filters);
      }

      // Fetch all tickers once; derive base currency prices from that list
      const allTickers = await this.getTickersWithCache(exchangeId);
      const basePrices = await this.getAllBaseCurrencyPrices(exchangeId, allTickers);

      // Filter to get only USDT spot pairs (altcoins)
      const altcoinTickers = allTickers.filter((ticker) => {
        const { base, quote } = parseSymbol(ticker.symbol);
        return (
          ticker.type === 'spot' &&
          quote === 'USDT' &&
          !EXCLUDED_BASES.includes(base) &&
          ticker.last !== null &&
          ticker.last > 0
        );
      });

      // Fetch mini OHLCV data for each altcoin (batched for performance)
      // Always use USD prices - client will calculate other bases from basePrices
      const altcoinsWithOHLCV = await this.fetchAltcoinsWithOHLCV(
        exchangeId,
        altcoinTickers,
        period
      );

      // Calculate aggregate statistics
      const stats = this.calculateStats(altcoinsWithOHLCV);

      // Get the requested base price for backwards compatibility
      const basePrice = basePrices[baseCurrency];

      // Build response with all base currency prices for client-side switching
      const response: AltScreenerResponse = {
        exchange: exchangeId,
        baseCurrency,
        basePrice,
        basePrices, // Include all prices so client can switch instantly
        period,
        altcoins: altcoinsWithOHLCV,
        count: altcoinsWithOHLCV.length,
        timestamp: Date.now(),
        stats,
      };

      // Cache the full response (60 seconds for better cache hits)
      cacheService.set(cacheKey, response, PERFORMANCE_CONFIG.SCREENER_CACHE_TTL_MS);

      // Apply sorting and filtering
      return this.applySortAndFilter(response, sortBy, sortOrder, limit, filters);
    } catch (error) {
      console.error(`Error in getAltcoins for ${exchangeId}:`, error);
      // Rethrow ApiErrors as-is, they're already properly classified
      if (isApiError(error)) {
        throw error;
      }
      // For other errors, wrap and rethrow to be handled by controller
      throw error;
    }
  }

  /**
   * Fetch all base currency prices in parallel
   * Used for client-side base currency switching without API refetch
   *
   * @param exchangeId - Exchange to fetch from
   * @returns Object with all base currency prices in USD
   */
  private async getAllBaseCurrencyPrices(
    exchangeId: SupportedExchange,
    allTickers?: Ticker[]
  ): Promise<BaseCurrencyPrices> {
    // Check cache first
    const cacheKey = `basePrices:${exchangeId}`;
    const cached = await cacheService.getAsync<BaseCurrencyPrices>(cacheKey);
    if (cached) return cached;

    // Use provided tickers (already fetched) or fetch once if needed
    const tickers = allTickers ?? (await this.getTickersWithCache(exchangeId));
    const getLast = (symbol: string) => tickers.find((t) => t.symbol === symbol)?.last ?? 0;

    const basePrices: BaseCurrencyPrices = {
      USD: 1 as const,
      BTC: getLast('BTC-USDT'),
      ETH: getLast('ETH-USDT'),
      SOL: getLast('SOL-USDT'),
    };

    // Cache base prices for 30 seconds (prices update frequently)
    cacheService.set(cacheKey, basePrices, 30000);

    return basePrices;
  }

  /**
   * Fetch OHLCV data for all altcoins and calculate performance
   * Processes in batches to avoid rate limiting
   * Always returns prices in USD - client handles base currency conversion
   *
   * @param exchangeId - Exchange to fetch from
   * @param tickers - Array of ticker data
   * @param period - Performance period
   * @returns Array of altcoin performance data with OHLCV (USD prices)
   */
  private async fetchAltcoinsWithOHLCV(
    exchangeId: SupportedExchange,
    tickers: Ticker[],
    period: PerformancePeriod
  ): Promise<AltcoinPerformance[]> {
    const timeframe = PERIOD_TIMEFRAMES[period];
    const candleLimit = PERIOD_CANDLE_LIMITS[period];
    const marketType = 'spot' as const;

    // Process in batches to avoid rate limiting
    // Using larger batch size (25) for faster loading while staying within rate limits
    const { BATCH_SIZE, BATCH_DELAY_MS } = PERFORMANCE_CONFIG;
    const results: AltcoinPerformance[] = [];

    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      const batch = tickers.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (ticker) => {
          try {
            // Check cache for OHLCV data
            const ohlcvCacheKey = `ohlcv:${exchangeId}:${ticker.symbol}:${timeframe}:${marketType}:${candleLimit}`;
            let ohlcv = await cacheService.getAsync<OHLCV[]>(ohlcvCacheKey);

            if (!ohlcv) {
              // Fetch OHLCV data
              ohlcv = await ccxtService.fetchOHLCV(
                exchangeId,
                ticker.symbol,
                timeframe,
                marketType,
                candleLimit
              );
              // Cache OHLCV data for 3 minutes (chart data doesn't change rapidly)
              cacheService.set(ohlcvCacheKey, ohlcv, PERFORMANCE_CONFIG.OHLCV_CACHE_TTL_MS);
            }

            // Parse symbol to get base and quote
            const { base, quote } = parseSymbol(ticker.symbol);

            // Always use USD price - client calculates other base currencies from basePrices
            const priceInUSD = ticker.last!;

            // Calculate performance changes based on USD price
            const changes = this.calculatePerformanceChanges(ohlcv, priceInUSD, timeframe);

            return {
              symbol: ticker.symbol,
              base,
              quote,
              exchange: exchangeId,
              type: ticker.type,
              price: priceInUSD,
              priceInBase: priceInUSD, // Same as price - client recalculates for other bases
              change1h: changes.change1h,
              change4h: changes.change4h,
              change24h: ticker.percentage24h,
              change7d: changes.change7d,
              volume24h: ticker.quoteVolume24h,
              high24h: ticker.high24h,
              low24h: ticker.low24h,
              ohlcv: ohlcv || [],
              timestamp: ticker.timestamp,
            } as AltcoinPerformance;
          } catch (_error) {
            // Return ticker with empty OHLCV on error
            const { base, quote } = parseSymbol(ticker.symbol);
            const priceInUSD = ticker.last!;
            return {
              symbol: ticker.symbol,
              base,
              quote,
              exchange: exchangeId,
              type: ticker.type,
              price: priceInUSD,
              priceInBase: priceInUSD,
              change1h: null,
              change4h: null,
              change24h: ticker.percentage24h,
              change7d: null,
              volume24h: ticker.quoteVolume24h,
              high24h: ticker.high24h,
              low24h: ticker.low24h,
              ohlcv: [],
              timestamp: ticker.timestamp,
            } as AltcoinPerformance;
          }
        })
      );

      results.push(...batchResults);

      // Small delay between batches to respect rate limits (50ms, reduced from 100ms)
      if (i + BATCH_SIZE < tickers.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    return results;
  }

  /**
   * Calculate performance changes from OHLCV data
   *
   * @param ohlcv - OHLCV data array
   * @param currentPrice - Current price in base currency
   * @param baseCurrency - Base currency being used
   * @returns Object with change percentages for different periods
   */
  private calculatePerformanceChanges(
    ohlcv: OHLCV[],
    currentPrice: number,
    timeframe: Timeframe
  ): { change1h: number | null; change4h: number | null; change7d: number | null } {
    if (!ohlcv || ohlcv.length === 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
      return { change1h: null, change4h: null, change7d: null };
    }

    // Sort by timestamp ascending
    const sortedOhlcv = [...ohlcv].sort((a, b) => a.timestamp - b.timestamp);

    const minutesPerCandle = TIMEFRAME_MINUTES[timeframe];
    if (!minutesPerCandle) {
      return { change1h: null, change4h: null, change7d: null };
    }

    const changeForMinutes = (minutes: number): number | null => {
      if (minutes % minutesPerCandle !== 0) {
        return null;
      }
      const candlesBack = minutes / minutesPerCandle;
      if (candlesBack <= 0 || sortedOhlcv.length < candlesBack) {
        return null;
      }
      const candleIndex = sortedOhlcv.length - candlesBack;
      const candle = sortedOhlcv[candleIndex];
      if (!candle || !Number.isFinite(candle.open) || candle.open <= 0) {
        return null;
      }
      return ((currentPrice - candle.open) / candle.open) * 100;
    };

    // Compute period changes based on the selected timeframe
    return {
      change1h: changeForMinutes(60),
      change4h: changeForMinutes(240),
      change7d: changeForMinutes(10080),
    };
  }

  /**
   * Calculate aggregate statistics for the screener response
   *
   * @param altcoins - Array of altcoin performance data
   * @returns Statistics object
   */
  private calculateStats(altcoins: AltcoinPerformance[]): AltScreenerResponse['stats'] {
    const withChange = altcoins.filter((a) => a.change24h !== null);
    const gainers = withChange.filter((a) => (a.change24h || 0) > 0);
    const losers = withChange.filter((a) => (a.change24h || 0) < 0);

    // Calculate average change
    const totalChange = withChange.reduce((sum, a) => sum + (a.change24h || 0), 0);
    const avgChange = withChange.length > 0 ? totalChange / withChange.length : 0;

    // Find top gainer and loser
    const sorted = [...withChange].sort((a, b) => (b.change24h || 0) - (a.change24h || 0));
    const topGainer = sorted[0]?.symbol || 'N/A';
    const topLoser = sorted[sorted.length - 1]?.symbol || 'N/A';

    return {
      totalAltcoins: altcoins.length,
      gainers: gainers.length,
      losers: losers.length,
      avgChange: Math.round(avgChange * 100) / 100,
      topGainer,
      topLoser,
    };
  }

  /**
   * Apply sorting and filtering to the response
   * This is applied after caching to allow different sort/filter without refetching
   *
   * @param response - Full screener response
   * @param sortBy - Field to sort by
   * @param sortOrder - Sort direction
   * @param limit - Maximum results
   * @param filters - Optional filters
   * @returns Filtered and sorted response
   */
  private applySortAndFilter(
    response: AltScreenerResponse,
    sortBy: ScreenerSortBy,
    sortOrder: 'asc' | 'desc',
    limit: number,
    filters?: ScreenerFilters
  ): AltScreenerResponse {
    let altcoins = [...response.altcoins];

    // Apply filters
    if (filters) {
      if (filters.minVolume !== undefined) {
        altcoins = altcoins.filter(
          (a) => a.volume24h !== null && a.volume24h >= filters.minVolume!
        );
      }
      if (filters.maxVolume !== undefined) {
        altcoins = altcoins.filter(
          (a) => a.volume24h !== null && a.volume24h <= filters.maxVolume!
        );
      }
      if (filters.minChange !== undefined) {
        altcoins = altcoins.filter(
          (a) => a.change24h !== null && a.change24h >= filters.minChange!
        );
      }
      if (filters.maxChange !== undefined) {
        altcoins = altcoins.filter(
          (a) => a.change24h !== null && a.change24h <= filters.maxChange!
        );
      }
      if (filters.type) {
        altcoins = altcoins.filter((a) => a.type === filters.type);
      }
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        altcoins = altcoins.filter(
          (a) =>
            a.symbol.toLowerCase().includes(searchLower) ||
            a.base.toLowerCase().includes(searchLower)
        );
      }
    }

    // Apply sorting
    altcoins.sort((a, b) => {
      let aValue: number = 0;
      let bValue: number = 0;

      switch (sortBy) {
        case 'performance':
          aValue = a.change24h || 0;
          bValue = b.change24h || 0;
          break;
        case 'volume':
          aValue = a.volume24h || 0;
          bValue = b.volume24h || 0;
          break;
        case 'price':
          aValue = a.price;
          bValue = b.price;
          break;
        case 'name':
          // For name sorting, use string comparison
          const compare = a.symbol.localeCompare(b.symbol);
          return sortOrder === 'asc' ? compare : -compare;
        default:
          aValue = a.change24h || 0;
          bValue = b.change24h || 0;
      }

      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
    });

    // Add rank without mutating cached altcoin objects
    const rankedAltcoins = altcoins.map((altcoin, index) => ({
      ...altcoin,
      rank: index + 1,
    }));

    // Apply limit
    altcoins = rankedAltcoins.slice(0, limit);

    return {
      ...response,
      altcoins,
      count: altcoins.length,
    };
  }

  /**
   * Get the OHLCV data for the base currency to calculate relative performance
   * Used when comparing altcoins against BTC/ETH/SOL instead of USD
   *
   * @param exchangeId - Exchange to fetch from
   * @param baseCurrency - Base currency
   * @param period - Performance period
   * @returns OHLCV data for the base currency
   */
  async getBaseCurrencyOHLCV(
    exchangeId: SupportedExchange,
    baseCurrency: BaseCurrency,
    period: PerformancePeriod
  ): Promise<OHLCV[]> {
    if (baseCurrency === 'USD') {
      return [];
    }

    const symbol = BASE_CURRENCY_SYMBOLS[baseCurrency];
    const timeframe = PERIOD_TIMEFRAMES[period];
    const candleLimit = PERIOD_CANDLE_LIMITS[period];

    return ccxtService.fetchOHLCV(exchangeId, symbol, timeframe, 'spot', candleLimit);
  }

  /**
   * Get lightweight altcoin data without OHLCV (for fast initial load)
   *
   * This is the FAST version that skips OHLCV fetching entirely.
   * Returns all ticker data with 24h change from the ticker itself.
   * Client can then fetch OHLCV data lazily for visible rows.
   *
   * Performance: ~1-2 seconds vs ~26 seconds for full data
   *
   * @param exchangeId - Exchange to fetch from (binance, bybit, okx)
   * @param baseCurrency - Currency to compare against (USD, BTC, ETH, SOL)
   * @param sortBy - Field to sort by
   * @param sortOrder - Sort direction
   * @param limit - Maximum number of results
   * @param filters - Optional filters
   * @returns AltScreenerResponse with ticker data but empty OHLCV arrays
   */
  async getAltcoinsLightweight(
    exchangeId: SupportedExchange,
    baseCurrency: BaseCurrency = 'USD',
    sortBy: ScreenerSortBy = 'performance',
    sortOrder: 'asc' | 'desc' = 'desc',
    limit: number = 100,
    filters?: ScreenerFilters
  ): Promise<AltScreenerResponse> {
    try {
      // Cache key for lightweight response (no period since we skip OHLCV)
      // Cache is base-currency agnostic - we normalize the response on cache hit
      const cacheKey = `screener:${exchangeId}:lightweight`;
      const cachedResult = await cacheService.getAsync<AltScreenerResponse>(cacheKey);

      if (cachedResult) {
        // Normalize response for requested base currency
        // The cached response has basePrices for all currencies, so we just update metadata
        const normalizedResult: AltScreenerResponse = {
          ...cachedResult,
          baseCurrency,
          basePrice: cachedResult.basePrices?.[baseCurrency] ?? 1,
        };
        // Apply sorting and filtering to normalized cached results
        return this.applySortAndFilter(normalizedResult, sortBy, sortOrder, limit, filters);
      }

      // Fetch all tickers once; derive base currency prices from that list
      const allTickers = await this.getTickersWithCache(exchangeId);
      const basePrices = await this.getAllBaseCurrencyPrices(exchangeId, allTickers);

      // Filter to get only USDT spot pairs (altcoins)
      const altcoinTickers = allTickers.filter((ticker) => {
        const { base, quote } = parseSymbol(ticker.symbol);
        return (
          ticker.type === 'spot' &&
          quote === 'USDT' &&
          !EXCLUDED_BASES.includes(base) &&
          ticker.last !== null &&
          ticker.last > 0
        );
      });

      // Convert tickers to AltcoinPerformance WITHOUT fetching OHLCV
      // This is the key optimization - we skip the slow part
      const altcoins: AltcoinPerformance[] = altcoinTickers.map((ticker) => {
        const { base, quote } = parseSymbol(ticker.symbol);
        const priceInUSD = ticker.last!;

        return {
          symbol: ticker.symbol,
          base,
          quote,
          exchange: exchangeId,
          type: ticker.type,
          price: priceInUSD,
          priceInBase: priceInUSD,
          // Use ticker's 24h change - no OHLCV needed for this
          change1h: null,
          change4h: null,
          change24h: ticker.percentage24h,
          change7d: null,
          volume24h: ticker.quoteVolume24h,
          high24h: ticker.high24h,
          low24h: ticker.low24h,
          // Empty OHLCV - client will fetch lazily if needed
          ohlcv: [],
          timestamp: ticker.timestamp,
        } as AltcoinPerformance;
      });

      // Calculate aggregate statistics
      const stats = this.calculateStats(altcoins);

      // Get the requested base price for backwards compatibility
      const basePrice = basePrices[baseCurrency];

      // Build response with all base currency prices for client-side switching
      const response: AltScreenerResponse = {
        exchange: exchangeId,
        baseCurrency,
        basePrice,
        basePrices,
        period: '24h', // Default period for lightweight
        altcoins,
        count: altcoins.length,
        timestamp: Date.now(),
        stats,
      };

      // Cache the lightweight response (30 seconds - shorter since it's fast to regenerate)
      cacheService.set(cacheKey, response, PERFORMANCE_CONFIG.LIGHTWEIGHT_CACHE_TTL_MS);

      // Apply sorting and filtering
      return this.applySortAndFilter(response, sortBy, sortOrder, limit, filters);
    } catch (error) {
      console.error(`Error in getAltcoinsLightweight for ${exchangeId}:`, error);
      if (isApiError(error)) {
        throw error;
      }
      throw error;
    }
  }

  /**
   * Get OHLCV data for specific symbols (for lazy loading)
   *
   * Client calls this endpoint to fetch OHLCV data for visible rows only.
   * This enables progressive loading where the table appears instantly
   * and charts load in as the user scrolls.
   *
   * @param exchangeId - Exchange to fetch from
   * @param symbols - Array of symbols to fetch OHLCV for
   * @param period - Performance period for chart granularity
   * @returns Map of symbol -> OHLCV data
   */
  async getOhlcvBatch(
    exchangeId: SupportedExchange,
    symbols: string[],
    period: PerformancePeriod = '24h'
  ): Promise<Record<string, OHLCV[]>> {
    const timeframe = PERIOD_TIMEFRAMES[period];
    const candleLimit = PERIOD_CANDLE_LIMITS[period];
    const marketType = 'spot' as const;
    const result: Record<string, OHLCV[]> = {};

    // Deduplicate to avoid redundant fetches
    const uniqueSymbols = Array.from(new Set(symbols));

    // Process in parallel with rate limit protection
    const { BATCH_SIZE, BATCH_DELAY_MS } = PERFORMANCE_CONFIG;

    for (let i = 0; i < uniqueSymbols.length; i += BATCH_SIZE) {
      const batch = uniqueSymbols.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (symbol) => {
          // Check cache first
          const ohlcvCacheKey = `ohlcv:${exchangeId}:${symbol}:${timeframe}:${marketType}:${candleLimit}`;
          let ohlcv = await cacheService.getAsync<OHLCV[]>(ohlcvCacheKey);

          if (!ohlcv) {
            try {
              ohlcv = await ccxtService.fetchOHLCV(
                exchangeId,
                symbol,
                timeframe,
                marketType,
                candleLimit
              );
              // Cache OHLCV data
              cacheService.set(ohlcvCacheKey, ohlcv, PERFORMANCE_CONFIG.OHLCV_CACHE_TTL_MS);
            } catch (_error) {
              ohlcv = [];
            }
          }

          return { symbol, ohlcv: ohlcv || [] };
        })
      );

      // Add batch results to output
      for (const { symbol, ohlcv } of batchResults) {
        result[symbol] = ohlcv;
      }

      // Delay between batches
      if (i + BATCH_SIZE < uniqueSymbols.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    return result;
  }
}

// Export singleton instance
export const screenerService = new ScreenerService();
