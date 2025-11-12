import { ccxtService } from './ccxtService';
import { cacheService } from './cacheService';
import { SupportedExchange, Timeframe, OHLCV } from '@lazuli/shared';

/**
 * Configuration for background refresh jobs
 * Customize these values to control what data gets refreshed and how often
 */
interface BackgroundJobConfig {
  // Ticker refresh settings
  tickerRefreshInterval: number; // Interval in milliseconds (default: 7000ms = 7s)
  enableTickerRefresh: boolean;
  exchanges: SupportedExchange[]; // Which exchanges to refresh

  // OHLCV refresh settings
  ohlcvRefreshInterval: number; // Interval in milliseconds (default: 7000ms = 7s)
  enableOhlcvRefresh: boolean;
  ohlcvTargets: OHLCVTarget[]; // Specific symbols and timeframes to refresh

  // Custom pair refresh settings
  customPairRefreshInterval: number; // Interval in milliseconds (default: 7000ms = 7s)
  enableCustomPairRefresh: boolean;
  customPairTargets: CustomPairTarget[]; // Custom pairs to refresh
}

/**
 * Target configuration for OHLCV refresh
 */
interface OHLCVTarget {
  exchange: SupportedExchange;
  symbol: string;
  timeframes: Timeframe[];
  marketType: 'spot' | 'perp';
  limit?: number; // Number of candles to fetch (default: 100)
}

/**
 * Target configuration for custom pair refresh
 */
interface CustomPairTarget {
  exchange: SupportedExchange;
  symbol1: string; // Numerator
  symbol2: string; // Denominator
  timeframes: Timeframe[];
  marketType: 'spot' | 'perp';
  limit?: number;
}

/**
 * Job statistics for monitoring
 */
interface JobStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastRunTime: number | null;
  lastError: string | null;
  isRunning: boolean;
}

/**
 * Background Job Service
 * Proactively refreshes ticker, OHLCV, and custom pair data in cache
 * Ensures data is always fresh when clients request it
 *
 * Key benefits:
 * - Reduced latency for client requests (data already in cache)
 * - Controlled rate limiting (centralized refresh vs many client requests)
 * - Consistent data freshness across all clients
 * - Better exchange API utilization
 */
export class BackgroundJobService {
  private config: BackgroundJobConfig;
  private tickerIntervalId?: NodeJS.Timeout;
  private ohlcvIntervalId?: NodeJS.Timeout;
  private customPairIntervalId?: NodeJS.Timeout;

  private tickerStats: JobStats;
  private ohlcvStats: JobStats;
  private customPairStats: JobStats;

  constructor(config?: Partial<BackgroundJobConfig>) {
    // Default configuration - can be overridden via constructor
    this.config = {
      // Ticker refresh: 7 seconds (to stay under cache TTL)
      tickerRefreshInterval: 7000,
      enableTickerRefresh: true,
      exchanges: ['binance', 'bybit', 'okx'],

      // OHLCV refresh: 7 seconds
      ohlcvRefreshInterval: 7000,
      enableOhlcvRefresh: true,
      ohlcvTargets: [], // Start empty, users should configure their targets

      // Custom pair refresh: 7 seconds
      customPairRefreshInterval: 7000,
      enableCustomPairRefresh: true,
      customPairTargets: [], // Start empty, users should configure their targets

      // Override with provided config
      ...config,
    };

    // Initialize job statistics
    this.tickerStats = this.createEmptyStats();
    this.ohlcvStats = this.createEmptyStats();
    this.customPairStats = this.createEmptyStats();
  }

  /**
   * Create empty job statistics
   */
  private createEmptyStats(): JobStats {
    return {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      lastRunTime: null,
      lastError: null,
      isRunning: false,
    };
  }

  /**
   * Start all enabled background jobs
   * Call this once during application startup
   */
  public startAllJobs(): void {
    console.log('🔄 Starting background refresh jobs...');

    if (this.config.enableTickerRefresh) {
      this.startTickerRefresh();
    }

    if (this.config.enableOhlcvRefresh && this.config.ohlcvTargets.length > 0) {
      this.startOhlcvRefresh();
    }

    if (this.config.enableCustomPairRefresh && this.config.customPairTargets.length > 0) {
      this.startCustomPairRefresh();
    }

    console.log('✅ Background refresh jobs started successfully');
    this.logConfiguration();
  }

  /**
   * Stop all background jobs
   * Call this during application shutdown
   */
  public stopAllJobs(): void {
    console.log('🛑 Stopping background refresh jobs...');

    if (this.tickerIntervalId) {
      clearInterval(this.tickerIntervalId);
      this.tickerIntervalId = undefined;
    }

    if (this.ohlcvIntervalId) {
      clearInterval(this.ohlcvIntervalId);
      this.ohlcvIntervalId = undefined;
    }

    if (this.customPairIntervalId) {
      clearInterval(this.customPairIntervalId);
      this.customPairIntervalId = undefined;
    }

    console.log('✅ All background jobs stopped');
  }

  /**
   * Start ticker refresh job
   * Refreshes all tickers for all configured exchanges
   */
  private startTickerRefresh(): void {
    console.log(`📊 Starting ticker refresh job (interval: ${this.config.tickerRefreshInterval}ms)`);
    console.log(`   Exchanges: ${this.config.exchanges.join(', ')}`);

    // Run immediately on startup
    this.refreshAllTickers();

    // Then run on interval
    this.tickerIntervalId = setInterval(
      () => this.refreshAllTickers(),
      this.config.tickerRefreshInterval
    );
  }

  /**
   * Start OHLCV refresh job
   * Refreshes OHLCV data for configured targets
   */
  private startOhlcvRefresh(): void {
    console.log(`📈 Starting OHLCV refresh job (interval: ${this.config.ohlcvRefreshInterval}ms)`);
    console.log(`   Targets: ${this.config.ohlcvTargets.length} symbol(s)`);

    // Run immediately on startup
    this.refreshAllOhlcv();

    // Then run on interval
    this.ohlcvIntervalId = setInterval(
      () => this.refreshAllOhlcv(),
      this.config.ohlcvRefreshInterval
    );
  }

  /**
   * Start custom pair refresh job
   * Refreshes custom pair data for configured targets
   */
  private startCustomPairRefresh(): void {
    console.log(`🔀 Starting custom pair refresh job (interval: ${this.config.customPairRefreshInterval}ms)`);
    console.log(`   Targets: ${this.config.customPairTargets.length} pair(s)`);

    // Run immediately on startup
    this.refreshAllCustomPairs();

    // Then run on interval
    this.customPairIntervalId = setInterval(
      () => this.refreshAllCustomPairs(),
      this.config.customPairRefreshInterval
    );
  }

  /**
   * Refresh all tickers for all configured exchanges
   * Updates cache with fresh data
   */
  private async refreshAllTickers(): Promise<void> {
    if (this.tickerStats.isRunning) {
      console.log('⏭️  Skipping ticker refresh - previous job still running');
      return;
    }

    this.tickerStats.isRunning = true;
    this.tickerStats.totalRuns++;
    const startTime = Date.now();

    try {
      console.log('🔄 [Ticker Refresh] Starting...');

      // Refresh tickers for all exchanges in parallel
      const promises = this.config.exchanges.map(async (exchange) => {
        try {
          console.log(`   Fetching tickers for ${exchange}...`);
          const tickers = await ccxtService.getAllTickers(exchange);

          // Update cache with fresh data
          // Use shorter TTL (7s) for background refresh to ensure cache doesn't expire
          const cacheKey = `tickers:${exchange}:raw`;
          cacheService.set(cacheKey, tickers, 7000);

          console.log(`   ✅ ${exchange}: ${tickers.length} tickers refreshed`);
          return { exchange, success: true, count: tickers.length };
        } catch (error) {
          console.error(`   ❌ ${exchange}: Failed to refresh tickers`, error);
          return { exchange, success: false, error };
        }
      });

      const results = await Promise.all(promises);
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      const duration = Date.now() - startTime;
      console.log(`✅ [Ticker Refresh] Completed in ${duration}ms (${successCount} success, ${failCount} failed)`);

      this.tickerStats.successfulRuns++;
      this.tickerStats.lastRunTime = Date.now();
      this.tickerStats.lastError = null;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [Ticker Refresh] Failed after ${duration}ms:`, error);

      this.tickerStats.failedRuns++;
      this.tickerStats.lastError = error instanceof Error ? error.message : 'Unknown error';
    } finally {
      this.tickerStats.isRunning = false;
    }
  }

  /**
   * Refresh OHLCV data for all configured targets
   * Updates cache with fresh candlestick data
   */
  private async refreshAllOhlcv(): Promise<void> {
    if (this.ohlcvStats.isRunning) {
      console.log('⏭️  Skipping OHLCV refresh - previous job still running');
      return;
    }

    this.ohlcvStats.isRunning = true;
    this.ohlcvStats.totalRuns++;
    const startTime = Date.now();

    try {
      console.log('🔄 [OHLCV Refresh] Starting...');

      // Flatten all targets into individual fetch operations
      const fetchOperations: Array<{
        exchange: SupportedExchange;
        symbol: string;
        timeframe: Timeframe;
        marketType: 'spot' | 'perp';
        limit: number;
      }> = [];

      for (const target of this.config.ohlcvTargets) {
        for (const timeframe of target.timeframes) {
          fetchOperations.push({
            exchange: target.exchange,
            symbol: target.symbol,
            timeframe,
            marketType: target.marketType,
            limit: target.limit || 100,
          });
        }
      }

      console.log(`   Total operations: ${fetchOperations.length}`);

      // Execute all fetches in parallel
      const promises = fetchOperations.map(async (op) => {
        try {
          const candles = await ccxtService.fetchOHLCV(
            op.exchange,
            op.symbol,
            op.timeframe,
            op.marketType,
            op.limit
          );

          // Update cache
          const cacheKey = `ohlcv:${op.exchange}:${op.symbol}:${op.timeframe}:${op.marketType}:${op.limit}`;
          cacheService.set(cacheKey, candles, 7000);

          return { success: true, op };
        } catch (error) {
          console.error(`   ❌ Failed: ${op.exchange}/${op.symbol}/${op.timeframe}`, error);
          return { success: false, op, error };
        }
      });

      const results = await Promise.all(promises);
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      const duration = Date.now() - startTime;
      console.log(`✅ [OHLCV Refresh] Completed in ${duration}ms (${successCount} success, ${failCount} failed)`);

      this.ohlcvStats.successfulRuns++;
      this.ohlcvStats.lastRunTime = Date.now();
      this.ohlcvStats.lastError = null;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [OHLCV Refresh] Failed after ${duration}ms:`, error);

      this.ohlcvStats.failedRuns++;
      this.ohlcvStats.lastError = error instanceof Error ? error.message : 'Unknown error';
    } finally {
      this.ohlcvStats.isRunning = false;
    }
  }

  /**
   * Refresh custom pair data for all configured targets
   * Fetches base symbols and calculates synthetic pairs
   */
  private async refreshAllCustomPairs(): Promise<void> {
    if (this.customPairStats.isRunning) {
      console.log('⏭️  Skipping custom pair refresh - previous job still running');
      return;
    }

    this.customPairStats.isRunning = true;
    this.customPairStats.totalRuns++;
    const startTime = Date.now();

    try {
      console.log('🔄 [Custom Pair Refresh] Starting...');

      // Process each custom pair target
      const promises = this.config.customPairTargets.map(async (target) => {
        try {
          // Process each timeframe for this custom pair
          const timeframePromises = target.timeframes.map(async (timeframe) => {
            const limit = target.limit || 100;

            // Fetch both symbols in parallel
            const [candles1, candles2] = await Promise.all([
              ccxtService.fetchOHLCV(
                target.exchange,
                target.symbol1,
                timeframe,
                target.marketType,
                limit
              ),
              ccxtService.fetchOHLCV(
                target.exchange,
                target.symbol2,
                timeframe,
                target.marketType,
                limit
              ),
            ]);

            // Calculate custom pair
            const customPairCandles = this.calculateCustomPair(candles1, candles2);

            // Update cache for custom pair
            const customPairCacheKey = `custom-pair:${target.exchange}:${target.symbol1}:${target.symbol2}:${timeframe}:${target.marketType}:${limit}`;
            cacheService.set(customPairCacheKey, customPairCandles, 7000);

            // Also update cache for individual symbols (so they're available for other requests)
            const cacheKey1 = `ohlcv:${target.exchange}:${target.symbol1}:${timeframe}:${target.marketType}:${limit}`;
            const cacheKey2 = `ohlcv:${target.exchange}:${target.symbol2}:${timeframe}:${target.marketType}:${limit}`;
            cacheService.set(cacheKey1, candles1, 7000);
            cacheService.set(cacheKey2, candles2, 7000);

            return { success: true };
          });

          await Promise.all(timeframePromises);
          return { success: true, target };
        } catch (error) {
          console.error(`   ❌ Failed: ${target.symbol1}/${target.symbol2}`, error);
          return { success: false, target, error };
        }
      });

      const results = await Promise.all(promises);
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      const duration = Date.now() - startTime;
      console.log(`✅ [Custom Pair Refresh] Completed in ${duration}ms (${successCount} success, ${failCount} failed)`);

      this.customPairStats.successfulRuns++;
      this.customPairStats.lastRunTime = Date.now();
      this.customPairStats.lastError = null;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [Custom Pair Refresh] Failed after ${duration}ms:`, error);

      this.customPairStats.failedRuns++;
      this.customPairStats.lastError = error instanceof Error ? error.message : 'Unknown error';
    } finally {
      this.customPairStats.isRunning = false;
    }
  }

  /**
   * Calculate custom pair OHLCV by dividing two symbol's prices
   * Same logic as customPairController but used for background refresh
   */
  private calculateCustomPair(candles1: OHLCV[], candles2: OHLCV[]): OHLCV[] {
    const candles2Map = new Map<number, OHLCV>();
    candles2.forEach(candle => {
      candles2Map.set(candle.timestamp, candle);
    });

    const customPairCandles: OHLCV[] = [];

    for (const candle1 of candles1) {
      const candle2 = candles2Map.get(candle1.timestamp);

      if (!candle2) {
        continue;
      }

      if (!candle1.open || !candle1.high || !candle1.low || !candle1.close ||
          !candle2.open || !candle2.high || !candle2.low || !candle2.close) {
        continue;
      }

      const customCandle: OHLCV = {
        timestamp: candle1.timestamp,
        open: candle1.open / candle2.open,
        high: candle1.high / candle2.high,
        low: candle1.low / candle2.low,
        close: candle1.close / candle2.close,
        volume: candle1.volume,
      };

      customPairCandles.push(customCandle);
    }

    return customPairCandles;
  }

  /**
   * Get current job statistics for monitoring
   */
  public getStats() {
    return {
      ticker: { ...this.tickerStats },
      ohlcv: { ...this.ohlcvStats },
      customPair: { ...this.customPairStats },
    };
  }

  /**
   * Get current configuration
   */
  public getConfig(): BackgroundJobConfig {
    return { ...this.config };
  }

  /**
   * Update configuration dynamically
   * Restarts affected jobs with new settings
   */
  public updateConfig(newConfig: Partial<BackgroundJobConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    console.log('🔧 Updating background job configuration...');

    // Restart affected jobs if configuration changed
    if (
      newConfig.tickerRefreshInterval !== undefined ||
      newConfig.enableTickerRefresh !== undefined ||
      newConfig.exchanges !== undefined
    ) {
      if (this.tickerIntervalId) {
        clearInterval(this.tickerIntervalId);
        this.tickerIntervalId = undefined;
      }
      if (this.config.enableTickerRefresh) {
        this.startTickerRefresh();
      }
    }

    if (
      newConfig.ohlcvRefreshInterval !== undefined ||
      newConfig.enableOhlcvRefresh !== undefined ||
      newConfig.ohlcvTargets !== undefined
    ) {
      if (this.ohlcvIntervalId) {
        clearInterval(this.ohlcvIntervalId);
        this.ohlcvIntervalId = undefined;
      }
      if (this.config.enableOhlcvRefresh && this.config.ohlcvTargets.length > 0) {
        this.startOhlcvRefresh();
      }
    }

    if (
      newConfig.customPairRefreshInterval !== undefined ||
      newConfig.enableCustomPairRefresh !== undefined ||
      newConfig.customPairTargets !== undefined
    ) {
      if (this.customPairIntervalId) {
        clearInterval(this.customPairIntervalId);
        this.customPairIntervalId = undefined;
      }
      if (this.config.enableCustomPairRefresh && this.config.customPairTargets.length > 0) {
        this.startCustomPairRefresh();
      }
    }

    console.log('✅ Configuration updated successfully');
  }

  /**
   * Add OHLCV target dynamically
   */
  public addOhlcvTarget(target: OHLCVTarget): void {
    this.config.ohlcvTargets.push(target);
    console.log(`📈 Added OHLCV target: ${target.exchange}/${target.symbol} (${target.timeframes.join(', ')})`);

    // Restart OHLCV refresh if enabled
    if (this.config.enableOhlcvRefresh && this.ohlcvIntervalId) {
      clearInterval(this.ohlcvIntervalId);
      this.ohlcvIntervalId = undefined;
      this.startOhlcvRefresh();
    }
  }

  /**
   * Add custom pair target dynamically
   */
  public addCustomPairTarget(target: CustomPairTarget): void {
    this.config.customPairTargets.push(target);
    console.log(`🔀 Added custom pair target: ${target.exchange}/${target.symbol1}/${target.symbol2}`);

    // Restart custom pair refresh if enabled
    if (this.config.enableCustomPairRefresh && this.customPairIntervalId) {
      clearInterval(this.customPairIntervalId);
      this.customPairIntervalId = undefined;
      this.startCustomPairRefresh();
    }
  }

  /**
   * Log current configuration for debugging
   */
  private logConfiguration(): void {
    console.log('\n📋 Background Job Configuration:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Ticker Refresh:`);
    console.log(`  Enabled: ${this.config.enableTickerRefresh}`);
    console.log(`  Interval: ${this.config.tickerRefreshInterval}ms`);
    console.log(`  Exchanges: ${this.config.exchanges.join(', ')}`);
    console.log(`\nOHLCV Refresh:`);
    console.log(`  Enabled: ${this.config.enableOhlcvRefresh}`);
    console.log(`  Interval: ${this.config.ohlcvRefreshInterval}ms`);
    console.log(`  Targets: ${this.config.ohlcvTargets.length} symbol(s)`);
    console.log(`\nCustom Pair Refresh:`);
    console.log(`  Enabled: ${this.config.enableCustomPairRefresh}`);
    console.log(`  Interval: ${this.config.customPairRefreshInterval}ms`);
    console.log(`  Targets: ${this.config.customPairTargets.length} pair(s)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

// Export singleton instance with default configuration
export const backgroundJobService = new BackgroundJobService();

// Export types for external use
export type { BackgroundJobConfig, OHLCVTarget, CustomPairTarget, JobStats };
