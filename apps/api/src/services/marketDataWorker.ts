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
 */

import { ccxtService } from './ccxtService';
import { cacheService } from './cacheService';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('market-data-worker');

/**
 * MarketDataWorker class
 *
 * Manages background polling of exchange ticker data and cache population.
 * Designed to be a singleton instance that runs for the lifetime of the server.
 */
export class MarketDataWorker {
  /** Flag to prevent multiple concurrent start() calls */
  private isRunning = false;

  /** Interval handle for cleanup on shutdown */
  private intervalHandle: ReturnType<typeof setTimeout> | null = null;

  /** Polling interval in milliseconds (5 seconds) */
  private readonly REFRESH_INTERVAL = 5000;

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
    });

    // Initial poll immediately on startup with safe scheduling
    void this.pollAndScheduleNext();
  }

  /**
   * Stop the background polling worker
   *
   * Cleans up the interval and stops polling.
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
}

/**
 * Singleton instance of MarketDataWorker
 * Import this to start/stop the worker from other modules
 */
export const marketDataWorker = new MarketDataWorker();
