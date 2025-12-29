/**
 * Market Data Worker Service
 *
 * Background worker that implements a "Write-Behind" cache warming strategy.
 * Polls cryptocurrency exchanges at regular intervals and pre-populates the cache
 * with ticker data, decoupling user requests from direct exchange API calls.
 *
 * Benefits:
 * - Reduced latency: API routes read from cache instead of waiting for exchange responses
 * - Rate limit protection: Controlled polling intervals prevent hitting exchange limits
 * - Improved reliability: Cache provides data even during temporary exchange outages
 *
 * Architecture:
 * - Polls all supported exchanges in parallel using Promise.allSettled
 * - Updates cache with key format: tickers:{exchange}:raw
 * - TTL is set slightly longer than poll interval to ensure data availability
 * - Pre-warms OHLCV cache for top altcoins to speed up screener loading
 */

import { ccxtService } from './ccxtService';
import { cacheService } from './cacheService';
import { screenerService } from './screenerService';
import { createServiceLogger } from '../utils/logger';
import { Ticker, PerformancePeriod, Timeframe, SupportedExchange } from '@lazuli/shared';
import { parseSymbol } from '../utils/validation';

const log = createServiceLogger('market-data-worker');

/**
 * Excluded base currencies from altcoin list (same as screenerService)
 * These are used as comparison bases, not shown as altcoins
 */
const EXCLUDED_BASES = ['BTC', 'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD'];

/**
 * Timeframe mapping for performance periods (same as screenerService)
 * Maps performance period to OHLCV timeframe for chart data
 */
const PERIOD_TIMEFRAMES: Record<PerformancePeriod, Timeframe> = {
  '1h': '5m',
  '4h': '15m',
  '24h': '1h',
  '7d': '4h',
  '30d': '1d',
};

/**
 * Number of candles to fetch for each period (same as screenerService)
 */
const PERIOD_CANDLE_LIMITS: Record<PerformancePeriod, number> = {
  '1h': 12,
  '4h': 16,
  '24h': 24,
  '7d': 42,
  '30d': 30,
};

/**
 * MarketDataWorker class
 *
 * Manages background polling of exchange ticker data and cache population.
 * Also pre-warms OHLCV cache for top altcoins to speed up screener loading.
 * Designed to be a singleton instance that runs for the lifetime of the server.
 */
export class MarketDataWorker {
  /** Flag to prevent multiple concurrent start() calls */
  private isRunning = false;

  /** Interval handle for cleanup on shutdown */
  private intervalHandle: ReturnType<typeof setTimeout> | null = null;

  /** Interval handle for OHLCV warming */
  private ohlcvIntervalHandle: ReturnType<typeof setTimeout> | null = null;

  /** Polling interval in milliseconds (5 seconds) */
  private readonly REFRESH_INTERVAL = 5000;

  /**
   * OHLCV warming interval in milliseconds (2 minutes)
   * Less frequent than ticker polling since chart data doesn't change as rapidly
   */
  private readonly OHLCV_WARM_INTERVAL = 120000;

  /**
   * Number of top altcoins to pre-warm OHLCV data for
   * Sorted by 24h volume to prioritize most traded coins
   */
  private readonly TOP_ALTCOINS_TO_WARM = 150;

  /**
   * OHLCV cache TTL in milliseconds (3 minutes)
   * Matches screenerService's OHLCV_CACHE_TTL_MS
   */
  private readonly OHLCV_CACHE_TTL = 180000;

  /**
   * Batch size for OHLCV fetching
   * Processes this many symbols at once to balance speed vs rate limits
   */
  private readonly OHLCV_BATCH_SIZE = 25;

  /**
   * Delay between OHLCV batches in milliseconds
   * Prevents hitting exchange rate limits
   */
  private readonly OHLCV_BATCH_DELAY = 50;

  /**
   * Cache TTL in milliseconds (10 seconds)
   * Set slightly longer than REFRESH_INTERVAL to ensure cache
   * doesn't expire between polls
   */
  private readonly CACHE_TTL = 10000;

  /**
   * Start the background polling worker
   *
   * Initiates periodic polling of all supported exchanges.
   * Also starts OHLCV cache warming for top altcoins.
   * Safe to call multiple times - subsequent calls are ignored if already running.
   */
  start(): void {
    if (this.isRunning) {
      log.warn('Market Data Worker already running, ignoring start() call');
      return;
    }

    this.isRunning = true;
    log.info('Starting Market Data Worker', {
      refreshInterval: this.REFRESH_INTERVAL,
      cacheTtl: this.CACHE_TTL,
      ohlcvWarmInterval: this.OHLCV_WARM_INTERVAL,
      topAltcoinsToWarm: this.TOP_ALTCOINS_TO_WARM,
    });

    // Initial poll immediately on startup with safe scheduling
    void this.pollAndScheduleNext();

    // Start OHLCV warming after a short delay to let ticker data populate first
    setTimeout(() => {
      void this.warmOhlcvAndScheduleNext();
    }, 5000);
  }

  /**
   * Stop the background polling worker
   *
   * Cleans up the interval and stops polling.
   * Also stops OHLCV warming.
   * Useful for graceful shutdown or testing.
   */
  stop(): void {
    if (!this.isRunning) {
      log.warn('Market Data Worker not running, ignoring stop() call');
      return;
    }

    if (this.intervalHandle) {
      clearTimeout(this.intervalHandle);
      this.intervalHandle = null;
    }

    if (this.ohlcvIntervalHandle) {
      clearTimeout(this.ohlcvIntervalHandle);
      this.ohlcvIntervalHandle = null;
    }

    this.isRunning = false;
    log.info('Market Data Worker stopped');
  }

  /**
   * Check if the worker is currently running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Poll all supported exchanges and update cache
   *
   * Fetches ticker data from all exchanges in parallel using Promise.allSettled
   * to ensure one exchange failure doesn't block others.
   *
   * Each exchange's data is cached independently with the key format:
   * tickers:{exchangeId}:raw
   */
  private async poll(): Promise<void> {
    const exchanges = ccxtService.getSupportedExchanges();
    const startTime = Date.now();

    log.debug('Starting poll cycle', { exchanges: exchanges.length });

    // Fetch all exchanges in parallel
    // Using Promise.allSettled to handle individual exchange failures gracefully
    const results = await Promise.allSettled(
      exchanges.map(async (exchangeId) => {
        return this.pollExchange(exchangeId);
      })
    );

    // Count successes and failures for logging
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
    const failed = results.filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === false)
    ).length;

    const duration = Date.now() - startTime;
    log.debug('Poll cycle completed', {
      succeeded,
      failed,
      duration: `${duration}ms`,
    });
  }

  /**
   * Run a poll cycle and schedule the next one after completion
   * Ensures only one poll runs at a time and errors are logged instead of throwing
   */
  private async pollAndScheduleNext(): Promise<void> {
    try {
      await this.poll();
    } catch (error) {
      log.error('Poll cycle failed', error as Error);
    }

    if (!this.isRunning) {
      return;
    }

    this.intervalHandle = setTimeout(() => {
      void this.pollAndScheduleNext();
    }, this.REFRESH_INTERVAL);
  }

  /**
   * Poll a single exchange and update its cache entry
   *
   * @param exchangeId - The exchange identifier (e.g., 'binance', 'bybit')
   * @returns true if successful, false if failed
   */
  private async pollExchange(exchangeId: string): Promise<boolean> {
    try {
      const tickers = await ccxtService.getAllTickers(exchangeId);
      const cacheKey = `tickers:${exchangeId}:raw`;

      // Update cache with fresh data
      // Fire-and-forget pattern: set() handles async Redis write internally
      cacheService.set(cacheKey, tickers, this.CACHE_TTL);

      log.debug('Cache updated', {
        exchange: exchangeId,
        count: tickers.length,
      });

      return true;
    } catch (error) {
      // Log error but don't throw - allows other exchanges to continue
      log.error('Failed to poll exchange', error as Error, {
        exchange: exchangeId,
      });
      return false;
    }
  }

  /**
   * Run OHLCV warming cycle and schedule the next one
   * Pre-warms OHLCV cache for top altcoins to speed up screener loading
   * Also pre-computes full screener responses after OHLCV warming
   */
  private async warmOhlcvAndScheduleNext(): Promise<void> {
    try {
      await this.warmOhlcvCache();
      // Pre-compute screener responses after OHLCV is warmed
      // This ensures screener cache is always warm for fast API responses
      await this.warmScreenerResponses();
    } catch (error) {
      log.error('OHLCV/Screener warming cycle failed', error as Error);
    }

    if (!this.isRunning) {
      return;
    }

    this.ohlcvIntervalHandle = setTimeout(() => {
      void this.warmOhlcvAndScheduleNext();
    }, this.OHLCV_WARM_INTERVAL);
  }

  /**
   * Exchanges with strict rate limits that need special handling
   * These will use larger batch delays and smaller batch sizes
   */
  private readonly STRICT_RATE_LIMIT_EXCHANGES = ['upbit'];

  /**
   * Batch size for exchanges with strict rate limits
   */
  private readonly STRICT_OHLCV_BATCH_SIZE = 5;

  /**
   * Batch delay for exchanges with strict rate limits (ms)
   */
  private readonly STRICT_OHLCV_BATCH_DELAY = 500;

  /**
   * Warm OHLCV cache for all exchanges
   * Fetches OHLCV data for top altcoins by volume and populates cache
   * Processes exchanges sequentially to avoid overwhelming rate limits
   */
  private async warmOhlcvCache(): Promise<void> {
    const exchanges = ccxtService.getSupportedExchanges();
    const startTime = Date.now();

    log.info('Starting OHLCV cache warming cycle', {
      exchanges: exchanges.length,
      topAltcoins: this.TOP_ALTCOINS_TO_WARM,
    });

    let succeeded = 0;
    let failed = 0;

    // Process exchanges sequentially to avoid rate limit issues
    // This is safer than parallel processing for OHLCV data
    for (const exchangeId of exchanges) {
      try {
        await this.warmExchangeOhlcv(exchangeId);
        succeeded++;
      } catch (_error) {
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    log.info('OHLCV cache warming completed', {
      succeeded,
      failed,
      duration: `${duration}ms`,
    });
  }

  /**
   * Warm OHLCV cache for a single exchange
   * Fetches ticker data, sorts by volume, and pre-warms top altcoins
   *
   * @param exchangeId - The exchange identifier
   */
  private async warmExchangeOhlcv(exchangeId: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Get tickers from cache or fetch fresh
      const cacheKey = `tickers:${exchangeId}:raw`;
      let tickers = cacheService.get<Ticker[]>(cacheKey);

      if (!tickers) {
        // Fallback to fresh fetch if cache is empty
        tickers = await ccxtService.getAllTickers(exchangeId);
      }

      // Filter to get only USDT spot pairs (altcoins)
      const altcoinTickers = tickers.filter((ticker) => {
        const { base, quote } = parseSymbol(ticker.symbol);
        return (
          ticker.type === 'spot' &&
          quote === 'USDT' &&
          !EXCLUDED_BASES.includes(base) &&
          ticker.last !== null &&
          ticker.last > 0
        );
      });

      // Sort by 24h volume (descending) and take top N
      const topAltcoins = altcoinTickers
        .sort((a, b) => (b.quoteVolume24h || 0) - (a.quoteVolume24h || 0))
        .slice(0, this.TOP_ALTCOINS_TO_WARM);

      // Warm OHLCV for the default period (24h) which is most commonly used
      const period: PerformancePeriod = '24h';
      const timeframe = PERIOD_TIMEFRAMES[period];
      const candleLimit = PERIOD_CANDLE_LIMITS[period];

      // Use smaller batch size and longer delays for exchanges with strict rate limits
      const isStrictRateLimit = this.STRICT_RATE_LIMIT_EXCHANGES.includes(exchangeId);
      const batchSize = isStrictRateLimit ? this.STRICT_OHLCV_BATCH_SIZE : this.OHLCV_BATCH_SIZE;
      const batchDelay = isStrictRateLimit ? this.STRICT_OHLCV_BATCH_DELAY : this.OHLCV_BATCH_DELAY;

      let warmedCount = 0;
      let skippedCount = 0;

      // Process in batches to respect rate limits
      for (let i = 0; i < topAltcoins.length; i += batchSize) {
        const batch = topAltcoins.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (ticker) => {
            const ohlcvCacheKey = `ohlcv:${exchangeId}:${ticker.symbol}:${timeframe}:spot:${candleLimit}`;

            // Skip if already cached
            if (cacheService.get(ohlcvCacheKey)) {
              skippedCount++;
              return;
            }

            try {
              const ohlcv = await ccxtService.fetchOHLCV(
                exchangeId,
                ticker.symbol,
                timeframe,
                'spot',
                candleLimit
              );

              cacheService.set(ohlcvCacheKey, ohlcv, this.OHLCV_CACHE_TTL);
              warmedCount++;
            } catch (_error) {
              // Silently skip failed OHLCV fetches - not all symbols may be available
            }
          })
        );

        // Delay between batches to respect rate limits
        if (i + batchSize < topAltcoins.length) {
          await new Promise((resolve) => setTimeout(resolve, batchDelay));
        }
      }

      const duration = Date.now() - startTime;
      log.info('Exchange OHLCV warming completed', {
        exchange: exchangeId,
        warmed: warmedCount,
        skipped: skippedCount,
        total: topAltcoins.length,
        duration: `${duration}ms`,
      });
    } catch (error) {
      log.error('Failed to warm OHLCV for exchange', error as Error, {
        exchange: exchangeId,
      });
      throw error;
    }
  }

  /**
   * Exchanges that only support perpetual markets (no spot)
   * These are excluded from screener warming since screener is spot-only
   */
  private readonly PERP_ONLY_EXCHANGES = ['hyperliquid'];

  /**
   * Pre-compute and cache full screener responses
   *
   * Builds the complete screener response (with OHLCV data) for each exchange
   * and caches it. This ensures the first user request is fast instead of
   * waiting 17+ seconds for OHLCV data to be fetched on-demand.
   *
   * Called after OHLCV warming completes since screener depends on OHLCV cache.
   */
  private async warmScreenerResponses(): Promise<void> {
    // Get all supported exchanges and filter out perp-only exchanges
    // Screener only works with spot markets
    const allExchanges = ccxtService.getSupportedExchanges();
    const exchanges = allExchanges.filter(
      (ex) => !this.PERP_ONLY_EXCHANGES.includes(ex)
    ) as SupportedExchange[];

    const period: PerformancePeriod = '24h'; // Most commonly used period
    const startTime = Date.now();

    log.info('Starting screener response warming', {
      exchanges: exchanges.length,
      period,
    });

    let succeeded = 0;
    let failed = 0;

    for (const exchange of exchanges) {
      try {
        // Call getAltcoins which computes and caches the full response
        // Using high limit (500) to pre-compute data for all altcoins
        await screenerService.getAltcoins(exchange, 'USD', period, 'performance', 'desc', 500);
        succeeded++;
        log.debug('Screener response warmed', { exchange, period });
      } catch (error) {
        failed++;
        log.warn('Failed to warm screener response', {
          exchange,
          period,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const duration = Date.now() - startTime;
    log.info('Screener response warming completed', {
      succeeded,
      failed,
      duration: `${duration}ms`,
    });
  }
}

/**
 * Singleton instance of MarketDataWorker
 * Import this to start/stop the worker from other modules
 */
export const marketDataWorker = new MarketDataWorker();
