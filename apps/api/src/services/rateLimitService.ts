/**
 * Rate Limiting Service
 *
 * Provides app-level rate limiting per exchange to complement CCXT's
 * built-in rate limiting. Tracks request counts and enforces limits
 * to prevent exceeding exchange API quotas.
 *
 * Features:
 * - Per-exchange rate limiting
 * - Sliding window algorithm for accurate tracking
 * - Configurable limits per exchange
 * - Statistics for monitoring
 *
 * Why needed:
 * - CCXT rate limiting is basic (simple delays)
 * - App-level tracking gives better visibility
 * - Allows coordination across multiple services
 * - Prevents cascading failures from rate limit violations
 */

import { SupportedExchange } from '@lazuli/shared';

interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerSecond?: number;
}

interface RateLimitStats {
  requestsLastMinute: number;
  requestsLastSecond: number;
  totalRequests: number;
  rejectedRequests: number;
  lastRequestTime: number | null;
}

interface RequestRecord {
  timestamp: number;
}

/**
 * RateLimitService
 * Manages rate limits per exchange using sliding window algorithm
 */
export class RateLimitService {
  private requests: Map<SupportedExchange, RequestRecord[]>;
  private stats: Map<SupportedExchange, RateLimitStats>;
  private config: Map<SupportedExchange, RateLimitConfig>;

  constructor() {
    this.requests = new Map();
    this.stats = new Map();
    this.config = new Map();

    // Initialize default rate limits based on exchange documentation
    // These are conservative limits to ensure we stay well under quotas
    this.setDefaultLimits();
  }

  /**
   * Set default rate limits for each exchange
   * Based on published exchange API limits (set conservatively)
   */
  private setDefaultLimits(): void {
    // Binance: 1200 requests per minute, 10 requests per second
    // https://binance-docs.github.io/apidocs/spot/en/#limits
    this.config.set('binance', {
      requestsPerMinute: 1000, // Conservative (actual: 1200)
      requestsPerSecond: 8,     // Conservative (actual: 10)
    });

    // Bybit: 120 requests per minute
    // https://bybit-exchange.github.io/docs/v5/rate-limit
    this.config.set('bybit', {
      requestsPerMinute: 100, // Conservative (actual: 120)
      requestsPerSecond: 5,
    });

    // OKX: 20 requests per 2 seconds = 600 per minute
    // https://www.okx.com/docs-v5/en/#overview-production-trading-services
    this.config.set('okx', {
      requestsPerMinute: 500, // Conservative (actual: 600)
      requestsPerSecond: 10,
    });

    // Initialize stats for each exchange
    for (const exchange of ['binance', 'bybit', 'okx'] as SupportedExchange[]) {
      this.stats.set(exchange, {
        requestsLastMinute: 0,
        requestsLastSecond: 0,
        totalRequests: 0,
        rejectedRequests: 0,
        lastRequestTime: null,
      });
      this.requests.set(exchange, []);
    }
  }

  /**
   * Check if a request can be made to the exchange
   * Returns true if within rate limits, false otherwise
   *
   * @param exchange - Exchange identifier
   * @returns true if request allowed, false if rate limited
   */
  canMakeRequest(exchange: SupportedExchange): boolean {
    this.cleanupOldRequests(exchange);

    const config = this.config.get(exchange);
    if (!config) {
      console.warn(`No rate limit config for ${exchange}, allowing request`);
      return true;
    }

    const requests = this.requests.get(exchange) || [];
    const now = Date.now();

    // Check requests per minute
    const requestsLastMinute = requests.filter(
      r => now - r.timestamp < 60000
    ).length;

    if (requestsLastMinute >= config.requestsPerMinute) {
      console.warn(
        `⚠️  [Rate Limit] ${exchange} exceeded per-minute limit ` +
        `(${requestsLastMinute}/${config.requestsPerMinute})`
      );
      return false;
    }

    // Check requests per second (if configured)
    if (config.requestsPerSecond) {
      const requestsLastSecond = requests.filter(
        r => now - r.timestamp < 1000
      ).length;

      if (requestsLastSecond >= config.requestsPerSecond) {
        console.warn(
          `⚠️  [Rate Limit] ${exchange} exceeded per-second limit ` +
          `(${requestsLastSecond}/${config.requestsPerSecond})`
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Record a request for an exchange
   * Should be called BEFORE making the actual API request
   *
   * @param exchange - Exchange identifier
   * @returns true if request recorded, false if rate limited
   */
  recordRequest(exchange: SupportedExchange): boolean {
    if (!this.canMakeRequest(exchange)) {
      // Update rejected requests stat
      const stats = this.stats.get(exchange);
      if (stats) {
        stats.rejectedRequests++;
      }
      return false;
    }

    const now = Date.now();
    const requests = this.requests.get(exchange) || [];

    // Add new request record
    requests.push({ timestamp: now });
    this.requests.set(exchange, requests);

    // Update stats
    const stats = this.stats.get(exchange);
    if (stats) {
      stats.totalRequests++;
      stats.lastRequestTime = now;
      stats.requestsLastMinute = requests.filter(r => now - r.timestamp < 60000).length;
      stats.requestsLastSecond = requests.filter(r => now - r.timestamp < 1000).length;
    }

    return true;
  }

  /**
   * Remove request records older than 1 minute
   * Keeps memory usage bounded
   */
  private cleanupOldRequests(exchange: SupportedExchange): void {
    const requests = this.requests.get(exchange);
    if (!requests) return;

    const now = Date.now();
    const cutoff = now - 60000; // 1 minute ago

    const recentRequests = requests.filter(r => r.timestamp > cutoff);
    this.requests.set(exchange, recentRequests);
  }

  /**
   * Get current rate limit usage for an exchange
   */
  getUsage(exchange: SupportedExchange): {
    requestsLastMinute: number;
    requestsLastSecond: number;
    perMinuteLimit: number;
    perSecondLimit: number | undefined;
    perMinuteUsage: number;
    perSecondUsage: number | undefined;
  } {
    this.cleanupOldRequests(exchange);

    const config = this.config.get(exchange);
    const requests = this.requests.get(exchange) || [];
    const now = Date.now();

    const requestsLastMinute = requests.filter(r => now - r.timestamp < 60000).length;
    const requestsLastSecond = requests.filter(r => now - r.timestamp < 1000).length;

    return {
      requestsLastMinute,
      requestsLastSecond,
      perMinuteLimit: config?.requestsPerMinute || 0,
      perSecondLimit: config?.requestsPerSecond,
      perMinuteUsage: config ? requestsLastMinute / config.requestsPerMinute : 0,
      perSecondUsage: config?.requestsPerSecond
        ? requestsLastSecond / config.requestsPerSecond
        : undefined,
    };
  }

  /**
   * Get statistics for all exchanges
   */
  getAllStats(): Record<string, RateLimitStats & { limits: RateLimitConfig }> {
    const result: Record<string, RateLimitStats & { limits: RateLimitConfig }> = {};

    for (const [exchange, stats] of this.stats.entries()) {
      const config = this.config.get(exchange)!;
      result[exchange] = {
        ...stats,
        limits: config,
      };
    }

    return result;
  }

  /**
   * Get stats for a specific exchange
   */
  getStats(exchange: SupportedExchange): (RateLimitStats & { limits: RateLimitConfig }) | null {
    const stats = this.stats.get(exchange);
    const config = this.config.get(exchange);

    if (!stats || !config) {
      return null;
    }

    return {
      ...stats,
      limits: config,
    };
  }

  /**
   * Update rate limit configuration for an exchange
   */
  setLimits(exchange: SupportedExchange, config: RateLimitConfig): void {
    this.config.set(exchange, config);
    console.log(`✅ [Rate Limit] Updated limits for ${exchange}:`, config);
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats(): void {
    for (const exchange of this.stats.keys()) {
      this.stats.set(exchange, {
        requestsLastMinute: 0,
        requestsLastSecond: 0,
        totalRequests: 0,
        rejectedRequests: 0,
        lastRequestTime: null,
      });
      this.requests.set(exchange, []);
    }
  }

  /**
   * Wait until rate limit allows request
   * Returns immediately if request allowed, otherwise waits
   *
   * @param exchange - Exchange identifier
   * @param maxWaitMs - Maximum time to wait in milliseconds
   * @returns true if request allowed, false if timed out
   */
  async waitForAllowance(
    exchange: SupportedExchange,
    maxWaitMs: number = 5000
  ): Promise<boolean> {
    const startTime = Date.now();

    while (!this.canMakeRequest(exchange)) {
      if (Date.now() - startTime >= maxWaitMs) {
        console.warn(`⚠️  [Rate Limit] Timeout waiting for ${exchange} rate limit`);
        return false;
      }

      // Wait 100ms before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return this.recordRequest(exchange);
  }
}

// Export singleton instance
export const rateLimitService = new RateLimitService();
