/**
 * Background Jobs Configuration Example
 *
 * This file demonstrates how to configure background refresh jobs
 * for tickers, OHLCV data, and custom pairs.
 *
 * USAGE:
 * 1. Copy this file to background-jobs.config.ts (or another name)
 * 2. Customize the configuration below
 * 3. Import and pass to backgroundJobService in src/index.ts:
 *    import { backgroundJobConfig } from './background-jobs.config';
 *    const backgroundJobService = new BackgroundJobService(backgroundJobConfig);
 *
 * OR use the API endpoints to dynamically configure targets:
 * - POST /api/v1/jobs/ohlcv-target - Add OHLCV targets
 * - POST /api/v1/jobs/custom-pair-target - Add custom pair targets
 * - PUT /api/v1/jobs/config - Update refresh intervals
 */

import { BackgroundJobConfig } from './src/services/backgroundJobService';

/**
 * Background job configuration
 * Customize these values based on your needs
 */
export const backgroundJobConfig: Partial<BackgroundJobConfig> = {
  // ============================================
  // TICKER REFRESH CONFIGURATION
  // ============================================
  // Automatically refreshes all tickers for specified exchanges
  // This ensures ticker data is always fresh in cache

  enableTickerRefresh: true,
  tickerRefreshInterval: 7000, // 7 seconds (recommended: 5-10s)
  exchanges: ['binance', 'bybit', 'okx'], // All supported exchanges

  // ============================================
  // OHLCV (CANDLESTICK) REFRESH CONFIGURATION
  // ============================================
  // Refreshes OHLCV data for specific symbols and timeframes
  // Configure the exact pairs and timeframes you need

  enableOhlcvRefresh: true,
  ohlcvRefreshInterval: 7000, // 7 seconds (recommended: 5-10s)

  // Define which symbols and timeframes to refresh
  ohlcvTargets: [
    // Example: BTC/USDT on Binance, multiple timeframes
    {
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timeframes: ['1m', '5m', '15m', '1h', '4h'],
      marketType: 'spot',
      limit: 100, // Number of candles to fetch
    },

    // Example: ETH/USDT on Binance
    {
      exchange: 'binance',
      symbol: 'ETH/USDT',
      timeframes: ['1m', '5m', '15m', '1h'],
      marketType: 'spot',
      limit: 100,
    },

    // Example: BTC/USDT perpetual on Bybit
    {
      exchange: 'bybit',
      symbol: 'BTC/USDT:USDT',
      timeframes: ['1m', '5m', '15m', '1h', '4h'],
      marketType: 'perp',
      limit: 100,
    },

    // Add more symbols as needed
    // Recommended: Start with your most-used pairs
    // You can add more via API: POST /api/v1/jobs/ohlcv-target
  ],

  // ============================================
  // CUSTOM PAIR (SYNTHETIC) REFRESH CONFIGURATION
  // ============================================
  // Refreshes custom pairs (e.g., BTC/ETH by dividing BTC/USDT by ETH/USDT)
  // Useful for multi-timeframe analysis of non-standard pairs

  enableCustomPairRefresh: true,
  customPairRefreshInterval: 7000, // 7 seconds (recommended: 5-10s)

  // Define which custom pairs to refresh
  customPairTargets: [
    // Example: BTC/ETH custom pair (BTC-USDT / ETH-USDT)
    {
      exchange: 'binance',
      symbol1: 'BTC/USDT', // Numerator
      symbol2: 'ETH/USDT', // Denominator
      timeframes: ['1m', '5m', '15m', '1h'],
      marketType: 'spot',
      limit: 100,
    },

    // Example: BTC/AVAX custom pair
    {
      exchange: 'binance',
      symbol1: 'BTC/USDT',
      symbol2: 'AVAX/USDT',
      timeframes: ['1m', '5m', '15m', '1h', '4h'],
      marketType: 'spot',
      limit: 100,
    },

    // Add more custom pairs as needed
    // You can add more via API: POST /api/v1/jobs/custom-pair-target
  ],
};

/**
 * PERFORMANCE TIPS:
 *
 * 1. Refresh Interval:
 *    - 5-10s is ideal for real-time monitoring
 *    - Lower = more fresh data but higher API usage
 *    - Higher = less API usage but slightly stale data
 *
 * 2. Target Selection:
 *    - Only add symbols you actively use
 *    - More targets = more API calls = higher rate limit usage
 *    - Start small and add more as needed
 *
 * 3. Timeframes:
 *    - Only include timeframes you display to users
 *    - Each timeframe = 1 API call per refresh interval
 *
 * 4. Rate Limits:
 *    - CCXT handles rate limiting automatically (enableRateLimit: true)
 *    - Monitor exchange API limits if adding many targets
 *    - Consider staggering refresh intervals if needed
 *
 * 5. Memory Usage:
 *    - Cache has max size of 1000 entries (configured in cacheService)
 *    - Each cache entry includes TTL and LRU eviction
 *    - Monitor memory if adding many symbols/timeframes
 */

/**
 * EXAMPLE USE CASES:
 *
 * Use Case 1: Multi-Timeframe Dashboard
 * - Enable OHLCV refresh for BTC/USDT on multiple timeframes
 * - Users see instant updates when viewing charts
 * - No loading delay, data always in cache
 *
 * Use Case 2: Custom Pair Analysis
 * - Enable custom pair refresh for BTC/ETH ratio
 * - Analyze relative strength across multiple timeframes
 * - Great for arbitrage or correlation strategies
 *
 * Use Case 3: Ticker Monitoring
 * - Enable ticker refresh for all exchanges
 * - Users see real-time prices across all pairs
 * - Useful for market scanning and opportunity detection
 */
