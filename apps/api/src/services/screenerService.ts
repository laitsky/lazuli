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
const PERIOD_TIMEFRAMES: Record<PerformancePeriod, string> = {
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
 * Performance optimization constants
 * Tuned for balance between speed and rate limit compliance
 */
const PERFORMANCE_CONFIG = {
  // Batch size for parallel OHLCV requests (increased from 10 for faster loading)
  BATCH_SIZE: 25,
  // Delay between batches in ms (reduced from 100ms)
  BATCH_DELAY_MS: 50,
  // Screener response cache TTL in ms (increased from 30s for better cache hits)
  SCREENER_CACHE_TTL_MS: 60000, // 60 seconds
  // OHLCV data cache TTL in ms (increased from 60s - chart data doesn't change rapidly)
  OHLCV_CACHE_TTL_MS: 180000, // 3 minutes
};

export class ScreenerService {
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
      const cachedResult = cacheService.get<AltScreenerResponse>(cacheKey);

      if (cachedResult) {
        // Apply sorting and filtering to cached results
        return this.applySortAndFilter(cachedResult, sortBy, sortOrder, limit, filters);
      }

      // Fetch all tickers and base currency prices in parallel for speed
      const [allTickers, basePrices] = await Promise.all([
        ccxtService.getAllTickers(exchangeId),
        this.getAllBaseCurrencyPrices(exchangeId),
      ]);

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
    exchangeId: SupportedExchange
  ): Promise<BaseCurrencyPrices> {
    // Check cache first
    const cacheKey = `basePrices:${exchangeId}`;
    const cached = cacheService.get<BaseCurrencyPrices>(cacheKey);
    if (cached) return cached;

    // Fetch BTC, ETH, SOL prices in parallel
    const [btcTicker, ethTicker, solTicker] = await Promise.all([
      ccxtService.getTicker(exchangeId, 'BTC-USDT'),
      ccxtService.getTicker(exchangeId, 'ETH-USDT'),
      ccxtService.getTicker(exchangeId, 'SOL-USDT'),
    ]);

    const basePrices: BaseCurrencyPrices = {
      USD: 1 as const,
      BTC: btcTicker?.last ?? 0,
      ETH: ethTicker?.last ?? 0,
      SOL: solTicker?.last ?? 0,
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
    const timeframe = PERIOD_TIMEFRAMES[period] as any;
    const candleLimit = PERIOD_CANDLE_LIMITS[period];

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
            const ohlcvCacheKey = `ohlcv:${exchangeId}:${ticker.symbol}:${timeframe}:${candleLimit}`;
            let ohlcv = cacheService.get<OHLCV[]>(ohlcvCacheKey);

            if (!ohlcv) {
              // Fetch OHLCV data
              ohlcv = await ccxtService.fetchOHLCV(
                exchangeId,
                ticker.symbol,
                timeframe,
                'spot',
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
            const changes = this.calculatePerformanceChanges(ohlcv, priceInUSD);

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
    currentPrice: number
  ): { change1h: number | null; change4h: number | null; change7d: number | null } {
    if (!ohlcv || ohlcv.length === 0) {
      return { change1h: null, change4h: null, change7d: null };
    }

    // Sort by timestamp ascending
    const sortedOhlcv = [...ohlcv].sort((a, b) => a.timestamp - b.timestamp);

    // Get first candle for period change
    const firstCandle = sortedOhlcv[0];

    // Calculate changes based on first candle
    const periodChange = firstCandle
      ? ((currentPrice - firstCandle.open) / firstCandle.open) * 100
      : null;

    // For different periods, we estimate based on available data
    return {
      change1h: ohlcv.length >= 12 ? periodChange : null,
      change4h: ohlcv.length >= 16 ? periodChange : null,
      change7d: ohlcv.length >= 42 ? periodChange : null,
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

    // Add rank to each altcoin
    altcoins.forEach((altcoin, index) => {
      altcoin.rank = index + 1;
    });

    // Apply limit
    altcoins = altcoins.slice(0, limit);

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
    const timeframe = PERIOD_TIMEFRAMES[period] as any;
    const candleLimit = PERIOD_CANDLE_LIMITS[period];

    return ccxtService.fetchOHLCV(exchangeId, symbol, timeframe, 'spot', candleLimit);
  }
}

// Export singleton instance
export const screenerService = new ScreenerService();
