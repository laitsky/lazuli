/**
 * Liquidation Service
 *
 * Handles fetching and processing liquidation data from multiple perpetual futures exchanges.
 * Provides real-time liquidation event aggregation, statistics, heatmap generation,
 * and cascade detection for trading analytics.
 *
 * Supported exchanges:
 * - Binance: forceOrders endpoint with WebSocket support
 * - Bybit: /v5/market/liquidation REST API
 * - OKX: /api/v5/public/liquidation-orders REST API
 * - Hyperliquid: /info endpoint for liquidations
 *
 * Data Flow:
 * 1. REST APIs poll for recent liquidations from each exchange
 * 2. Data is normalized to unified LiquidationEvent format
 * 3. Events are cached with short TTL for near real-time updates
 * 4. Analytics (stats, heatmap, cascades) computed on demand
 */

import { createServiceLogger } from '../utils/logger';
import { cacheService } from './cacheService';
import { ccxtService } from './ccxtService';
import {
  LiquidationEvent,
  LiquidationExchange,
  LiquidationStats,
  LiquidationHeatmap,
  LiquidationBucket,
  CascadeAlert,
  LiquidationZone,
  AggregatedLiquidations,
  LiveLiquidationFeed,
  DEFAULT_CASCADE_CONFIG,
  CASCADE_SEVERITY_THRESHOLDS,
} from '@lazuli/shared';
import { classifyCcxtError, ExchangeError, ErrorCode } from '../errors';

// Create logger for liquidation service
const log = createServiceLogger('liquidation');

/**
 * Configuration for liquidation data fetching and processing
 */
const LIQUIDATION_CONFIG = {
  // Cache TTLs (in milliseconds)
  CACHE_TTL_LIVE: 5000, // Live feed - 5 second cache
  CACHE_TTL_STATS: 30000, // Stats - 30 second cache
  CACHE_TTL_HEATMAP: 60000, // Heatmap - 1 minute cache
  CACHE_TTL_ZONES: 120000, // Zones - 2 minute cache

  // Data limits
  DEFAULT_LIMIT: 100,
  MAX_LIMIT: 500,

  // Supported perpetual exchanges for liquidation data
  // Note: Binance uses WebSocket (REST deprecated), Hyperliquid has no public liquidation API
  SUPPORTED_EXCHANGES: ['binance', 'bybit', 'okx'] as LiquidationExchange[],

  // Heatmap configuration
  DEFAULT_HEATMAP_BUCKETS: 50,
  HEATMAP_PRICE_RANGE_PERCENT: 10, // 10% above and below current price

  // Cascade detection
  CASCADE_ROLLING_WINDOW: 60000, // 60 second rolling window
};

/**
 * In-memory storage for recent liquidations and cascade tracking
 * Used for real-time cascade detection
 */
interface LiquidationMemoryStore {
  events: Map<string, LiquidationEvent[]>; // exchange:symbol -> events
  cascades: Map<string, CascadeAlert>; // cascadeId -> alert
  lastFetch: Map<string, number>; // exchange -> timestamp
}

const memoryStore: LiquidationMemoryStore = {
  events: new Map(),
  cascades: new Map(),
  lastFetch: new Map(),
};

/**
 * LiquidationService class
 * Handles all liquidation data fetching, processing, and analytics
 */
class LiquidationService {
  /**
   * Check if an exchange is supported for liquidation data
   */
  isExchangeSupported(exchange: string): exchange is LiquidationExchange {
    return LIQUIDATION_CONFIG.SUPPORTED_EXCHANGES.includes(exchange as LiquidationExchange);
  }

  /**
   * Get list of supported exchanges for liquidation data
   */
  getSupportedExchanges(): LiquidationExchange[] {
    return [...LIQUIDATION_CONFIG.SUPPORTED_EXCHANGES];
  }

  /**
   * Fetch recent liquidations from a specific exchange
   * Uses exchange-specific APIs to fetch liquidation data
   *
   * @param exchange - Exchange identifier
   * @param symbol - Optional symbol filter (e.g., "BTCUSDT")
   * @param limit - Maximum number of liquidations to return
   * @param since - Optional timestamp to fetch liquidations since
   * @returns Array of normalized liquidation events
   */
  async getLiquidations(
    exchange: string,
    symbol?: string,
    limit: number = LIQUIDATION_CONFIG.DEFAULT_LIMIT,
    since?: number
  ): Promise<LiquidationEvent[]> {
    if (!this.isExchangeSupported(exchange)) {
      throw new ExchangeError(
        ErrorCode.EXCHANGE_NOT_SUPPORTED,
        `Exchange ${exchange} is not supported for liquidation data. Supported: ${LIQUIDATION_CONFIG.SUPPORTED_EXCHANGES.join(', ')}`,
        exchange
      );
    }

    // Check cache first
    const cacheKey = `liquidations:${exchange}:${symbol || 'all'}:${limit}`;
    const cached = cacheService.get<LiquidationEvent[]>(cacheKey);
    if (cached) {
      log.debug('Cache hit for liquidations', { exchange, symbol, limit });
      return cached;
    }

    try {
      let liquidations: LiquidationEvent[];

      // Fetch liquidations using exchange-specific method
      switch (exchange) {
        case 'binance':
          liquidations = await this.fetchBinanceLiquidations(symbol, limit);
          break;
        case 'bybit':
          liquidations = await this.fetchBybitLiquidations(symbol, limit);
          break;
        case 'okx':
          liquidations = await this.fetchOkxLiquidations(symbol, limit);
          break;
        case 'hyperliquid':
          liquidations = await this.fetchHyperliquidLiquidations(symbol, limit);
          break;
        default:
          liquidations = [];
      }

      // Filter by since timestamp if provided
      if (since) {
        liquidations = liquidations.filter((l) => l.timestamp >= since);
      }

      // Sort by timestamp descending (most recent first)
      liquidations.sort((a, b) => b.timestamp - a.timestamp);

      // Limit results
      liquidations = liquidations.slice(0, Math.min(limit, LIQUIDATION_CONFIG.MAX_LIMIT));

      // Cache the results
      cacheService.set(cacheKey, liquidations, LIQUIDATION_CONFIG.CACHE_TTL_LIVE);

      // Update memory store for cascade detection
      this.updateMemoryStore(exchange, liquidations);

      log.debug('Fetched liquidations', {
        exchange,
        symbol,
        count: liquidations.length,
      });

      return liquidations;
    } catch (error) {
      log.error('Error fetching liquidations', error, { exchange, symbol });
      if (error instanceof ExchangeError) {
        throw error;
      }
      throw classifyCcxtError(error, exchange);
    }
  }

  /**
   * Fetch liquidations from Binance via WebSocket buffer
   * Note: The public REST API is deprecated.
   * Uses the WebSocket service buffer which connects to: wss://fstream.binance.com/ws/!forceOrder@arr
   */
  private async fetchBinanceLiquidations(
    symbol?: string,
    limit: number = 100
  ): Promise<LiquidationEvent[]> {
    // Import here to avoid circular dependency
    const { liquidationWebSocketService } = await import('./liquidationWebSocketService');

    // Get events from WebSocket buffer
    const events = liquidationWebSocketService.getEventsByExchange('binance', limit, symbol);

    if (events.length === 0) {
      log.debug('No Binance liquidations in buffer, WebSocket may not be connected');
    }

    return events;
  }

  /**
   * Fetch liquidations from Bybit API
   * Uses the /v5/market/recent-trade endpoint with liquidation filter
   */
  private async fetchBybitLiquidations(
    symbol?: string,
    limit: number = 100
  ): Promise<LiquidationEvent[]> {
    try {
      const baseUrl = 'https://api.bybit.com';
      const endpoint = '/v5/market/recent-trade';

      // Bybit requires a specific symbol, so if not provided, use major pairs
      const symbols = symbol
        ? [symbol.replace('.P', '').replace('-', '')]
        : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

      const allLiquidations: LiquidationEvent[] = [];

      for (const sym of symbols) {
        const params = new URLSearchParams({
          category: 'linear',
          symbol: sym,
          limit: Math.min(limit, 1000).toString(),
        });

        const response = await fetch(`${baseUrl}${endpoint}?${params.toString()}`);

        if (!response.ok) {
          log.warn(`Bybit API error for ${sym}: ${response.status}`);
          continue;
        }

        const data = (await response.json()) as any;

        if (data.retCode === 0 && data.result?.list) {
          // Filter for liquidation trades (they have isBlockTrade or special markers)
          const liquidations = data.result.list
            .filter((trade: any) => trade.isBlockTrade === true || trade.side)
            .map((trade: any) => this.normalizeBybitLiquidation(trade, sym));

          allLiquidations.push(...liquidations);
        }
      }

      return allLiquidations;
    } catch (error) {
      log.error('Error fetching Bybit liquidations', error);
      throw error;
    }
  }

  /**
   * Normalize Bybit trade/liquidation data to unified format
   */
  private normalizeBybitLiquidation(trade: any, symbol: string): LiquidationEvent {
    const quantity = parseFloat(trade.size || '0');
    const price = parseFloat(trade.price || '0');

    return {
      id: `bybit-${symbol}-${trade.execId || trade.time}`,
      symbol,
      exchange: 'bybit',
      side: trade.side === 'Sell' ? 'long' : 'short',
      price,
      quantity,
      value: quantity * price,
      timestamp: parseInt(trade.time) || Date.now(),
    };
  }

  /**
   * Fetch liquidations from OKX API
   * Uses the /api/v5/public/liquidation-orders endpoint
   * Requires: uly (underlying) and state parameters
   */
  private async fetchOkxLiquidations(
    symbol?: string,
    limit: number = 100
  ): Promise<LiquidationEvent[]> {
    try {
      const baseUrl = 'https://www.okx.com';
      const endpoint = '/api/v5/public/liquidation-orders';

      // OKX requires underlying (uly) parameter - fetch multiple if no symbol specified
      const underlyings = symbol
        ? [this.symbolToOkxUnderlying(symbol)]
        : ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];

      const allLiquidations: LiquidationEvent[] = [];

      for (const uly of underlyings) {
        const params = new URLSearchParams({
          instType: 'SWAP',
          uly,
          state: 'filled', // Required parameter
          limit: Math.min(limit, 100).toString(),
        });

        const response = await fetch(`${baseUrl}${endpoint}?${params.toString()}`);

        if (!response.ok) {
          log.warn(`OKX API error for ${uly}: ${response.status}`);
          continue;
        }

        const data = (await response.json()) as any;

        if (data.code !== '0' || !data.data) {
          log.warn('OKX API returned error', { code: data.code, msg: data.msg, uly });
          continue;
        }

        // OKX returns nested structure with liquidation details
        for (const item of data.data) {
          if (item.details) {
            for (const detail of item.details) {
              allLiquidations.push(
                this.normalizeOkxLiquidation(detail, item.instId || `${uly}-SWAP`)
              );
            }
          }
        }
      }

      return allLiquidations;
    } catch (error) {
      log.error('Error fetching OKX liquidations', error);
      throw error;
    }
  }

  /**
   * Convert symbol to OKX underlying format
   * e.g., BTCUSDT -> BTC-USDT, BTC-USDT -> BTC-USDT
   */
  private symbolToOkxUnderlying(symbol: string): string {
    const cleanSymbol = symbol.replace('.P', '').replace('-', '');
    if (cleanSymbol.endsWith('USDT')) {
      const base = cleanSymbol.slice(0, -4);
      return `${base}-USDT`;
    }
    return symbol;
  }

  /**
   * Normalize OKX liquidation data to unified format
   */
  private normalizeOkxLiquidation(detail: any, instId: string): LiquidationEvent {
    const quantity = parseFloat(detail.sz || '0');
    const price = parseFloat(detail.bkPx || '0');
    const bankruptcyPrice = parseFloat(detail.bkPx || '0');

    // Extract symbol from instId (e.g., BTC-USDT-SWAP -> BTCUSDT)
    const symbolParts = instId.split('-');
    const symbol = `${symbolParts[0]}${symbolParts[1]}`;

    // OKX uses posSide (long/short) to indicate which position was liquidated
    // side (buy/sell) indicates the liquidation order direction
    return {
      id: `okx-${symbol}-${detail.ts}-${detail.sz}`,
      symbol,
      exchange: 'okx',
      side: detail.posSide === 'short' ? 'short' : 'long',
      price,
      quantity,
      value: quantity * price,
      timestamp: parseInt(detail.ts) || Date.now(),
      bankruptcyPrice,
    };
  }

  /**
   * Fetch liquidations from Hyperliquid API
   * Note: Hyperliquid does not provide a public liquidation stream/endpoint
   */
  private async fetchHyperliquidLiquidations(
    _symbol?: string,
    _limit: number = 100
  ): Promise<LiquidationEvent[]> {
    // Hyperliquid does not support public liquidation data
    log.debug('Hyperliquid does not provide public liquidation data');
    return [];
  }

  /**
   * Update in-memory store with new liquidations for cascade detection
   */
  private updateMemoryStore(exchange: string, liquidations: LiquidationEvent[]): void {
    const now = Date.now();

    for (const liq of liquidations) {
      const key = `${exchange}:${liq.symbol}`;
      const existing = memoryStore.events.get(key) || [];

      // Add new liquidation if not duplicate
      if (!existing.some((e) => e.id === liq.id)) {
        existing.push(liq);
      }

      // Remove old events outside the cascade window
      const windowStart = now - LIQUIDATION_CONFIG.CASCADE_ROLLING_WINDOW * 2;
      const filtered = existing.filter((e) => e.timestamp >= windowStart);

      memoryStore.events.set(key, filtered);
    }

    memoryStore.lastFetch.set(exchange, now);

    // Check for cascades
    this.detectCascades(exchange);
  }

  /**
   * Detect liquidation cascades based on volume thresholds
   */
  private detectCascades(exchange: string): void {
    const now = Date.now();
    const windowStart = now - DEFAULT_CASCADE_CONFIG.timeWindowMs;

    // Group events by symbol
    const symbolEvents = new Map<string, LiquidationEvent[]>();

    for (const [key, events] of memoryStore.events) {
      if (!key.startsWith(`${exchange}:`)) continue;

      const symbol = key.split(':')[1];
      const recentEvents = events.filter((e) => e.timestamp >= windowStart);

      if (recentEvents.length >= DEFAULT_CASCADE_CONFIG.minLiquidationCount) {
        symbolEvents.set(symbol, recentEvents);
      }
    }

    // Check each symbol for cascade conditions
    for (const [symbol, events] of symbolEvents) {
      const totalValue = events.reduce((sum, e) => sum + e.value, 0);

      if (totalValue >= DEFAULT_CASCADE_CONFIG.thresholdUsd) {
        const longValue = events
          .filter((e) => e.side === 'long')
          .reduce((sum, e) => sum + e.value, 0);
        const shortValue = events
          .filter((e) => e.side === 'short')
          .reduce((sum, e) => sum + e.value, 0);

        // Determine cascade type
        let type: CascadeAlert['type'];
        if (longValue > shortValue * 2) {
          type = 'long_cascade';
        } else if (shortValue > longValue * 2) {
          type = 'short_cascade';
        } else {
          type = 'mixed_cascade';
        }

        // Determine severity
        let severity: CascadeAlert['severity'];
        if (totalValue >= CASCADE_SEVERITY_THRESHOLDS.extreme) {
          severity = 'extreme';
        } else if (totalValue >= CASCADE_SEVERITY_THRESHOLDS.critical) {
          severity = 'critical';
        } else {
          severity = 'warning';
        }

        // Calculate price change
        const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
        const startPrice = sortedEvents[0].price;
        const endPrice = sortedEvents[sortedEvents.length - 1].price;
        const priceChange = endPrice - startPrice;
        const priceChangePercent = (priceChange / startPrice) * 100;

        const cascadeId = `${exchange}-${symbol}-${Math.floor(windowStart / 60000)}`;

        const cascade: CascadeAlert = {
          id: cascadeId,
          symbol,
          exchange,
          type,
          severity,
          totalValue,
          liquidationCount: events.length,
          duration: (now - sortedEvents[0].timestamp) / 1000,
          priceChange,
          priceChangePercent,
          startTime: sortedEvents[0].timestamp,
          lastUpdate: sortedEvents[sortedEvents.length - 1].timestamp,
          isActive: true,
        };

        memoryStore.cascades.set(cascadeId, cascade);
      }
    }

    // Mark old cascades as inactive
    for (const [, cascade] of memoryStore.cascades) {
      if (cascade.lastUpdate < windowStart) {
        cascade.isActive = false;
      }
    }
  }

  /**
   * Aggregate liquidations across all supported exchanges for a symbol
   */
  async getAllExchangeLiquidations(
    symbol: string,
    limit: number = 50
  ): Promise<AggregatedLiquidations> {
    const cacheKey = `liquidations:aggregate:${symbol}:${limit}`;
    const cached = cacheService.get<AggregatedLiquidations>(cacheKey);
    if (cached) {
      return cached;
    }

    const results = await Promise.allSettled(
      LIQUIDATION_CONFIG.SUPPORTED_EXCHANGES.map((exchange) =>
        this.getLiquidations(exchange, symbol, limit)
      )
    );

    const allLiquidations: LiquidationEvent[] = [];
    const byExchange: AggregatedLiquidations['byExchange'] = {};

    LIQUIDATION_CONFIG.SUPPORTED_EXCHANGES.forEach((exchange, index) => {
      const result = results[index];

      if (result.status === 'fulfilled') {
        const liquidations = result.value;
        allLiquidations.push(...liquidations);

        byExchange[exchange] = {
          count: liquidations.length,
          totalValue: liquidations.reduce((sum, l) => sum + l.value, 0),
          longCount: liquidations.filter((l) => l.side === 'long').length,
          shortCount: liquidations.filter((l) => l.side === 'short').length,
        };
      } else {
        log.warn(`Failed to fetch liquidations from ${exchange}`, {
          error: result.reason,
        });
        byExchange[exchange] = {
          count: 0,
          totalValue: 0,
          longCount: 0,
          shortCount: 0,
        };
      }
    });

    // Sort all liquidations by timestamp
    allLiquidations.sort((a, b) => b.timestamp - a.timestamp);

    const aggregated: AggregatedLiquidations = {
      symbol,
      liquidations: allLiquidations.slice(0, limit),
      byExchange,
      meta: {
        exchanges: LIQUIDATION_CONFIG.SUPPORTED_EXCHANGES,
        totalCount: allLiquidations.length,
        totalValue: allLiquidations.reduce((sum, l) => sum + l.value, 0),
        timestamp: Date.now(),
      },
    };

    cacheService.set(cacheKey, aggregated, LIQUIDATION_CONFIG.CACHE_TTL_LIVE);

    return aggregated;
  }

  /**
   * Calculate liquidation statistics for analytics
   */
  async getLiquidationStats(
    exchange: string,
    symbol?: string,
    period: '1h' | '4h' | '24h' = '24h'
  ): Promise<LiquidationStats> {
    const cacheKey = `liquidations:stats:${exchange}:${symbol || 'all'}:${period}`;
    const cached = cacheService.get<LiquidationStats>(cacheKey);
    if (cached) {
      return cached;
    }

    // Calculate time window based on period
    const periodMs = {
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    }[period];

    const since = Date.now() - periodMs;

    // Fetch liquidations for the period
    const liquidations = await this.getLiquidations(
      exchange,
      symbol,
      LIQUIDATION_CONFIG.MAX_LIMIT,
      since
    );

    // Calculate statistics
    const longLiquidations = liquidations.filter((l) => l.side === 'long');
    const shortLiquidations = liquidations.filter((l) => l.side === 'short');

    const longValue = longLiquidations.reduce((sum, l) => sum + l.value, 0);
    const shortValue = shortLiquidations.reduce((sum, l) => sum + l.value, 0);
    const totalValue = longValue + shortValue;

    // Find largest liquidation
    const largestLiquidation =
      liquidations.length > 0
        ? liquidations.reduce((max, l) => (l.value > max.value ? l : max))
        : null;

    // Calculate intensity (liquidations per minute)
    const durationMinutes = periodMs / 60000;
    const intensity = liquidations.length / durationMinutes;

    // Group by symbol for top symbols
    const symbolMap = new Map<string, { count: number; value: number }>();
    for (const liq of liquidations) {
      const existing = symbolMap.get(liq.symbol) || { count: 0, value: 0 };
      existing.count++;
      existing.value += liq.value;
      symbolMap.set(liq.symbol, existing);
    }

    const topSymbols = Array.from(symbolMap.entries())
      .map(([sym, data]) => ({ symbol: sym, ...data }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Calculate hourly breakdown
    const hourlyMap = new Map<number, { count: number; value: number }>();
    for (const liq of liquidations) {
      const hour = new Date(liq.timestamp).getUTCHours();
      const existing = hourlyMap.get(hour) || { count: 0, value: 0 };
      existing.count++;
      existing.value += liq.value;
      hourlyMap.set(hour, existing);
    }

    const hourlyBreakdown = Array.from(hourlyMap.entries())
      .map(([hour, data]) => ({ hour, ...data }))
      .sort((a, b) => a.hour - b.hour);

    const stats: LiquidationStats = {
      exchange,
      symbol,
      period,
      totalCount: liquidations.length,
      totalValue,
      longCount: longLiquidations.length,
      shortCount: shortLiquidations.length,
      longValue,
      shortValue,
      longShortRatio: shortValue > 0 ? longValue / shortValue : longValue > 0 ? Infinity : 1,
      largestLiquidation,
      intensity,
      topSymbols,
      hourlyBreakdown,
      timestamp: Date.now(),
    };

    cacheService.set(cacheKey, stats, LIQUIDATION_CONFIG.CACHE_TTL_STATS);

    return stats;
  }

  /**
   * Generate heatmap data showing liquidation density by price level
   */
  async getLiquidationHeatmap(
    exchange: string,
    symbol: string,
    bucketCount: number = LIQUIDATION_CONFIG.DEFAULT_HEATMAP_BUCKETS
  ): Promise<LiquidationHeatmap> {
    const cacheKey = `liquidations:heatmap:${exchange}:${symbol}:${bucketCount}`;
    const cached = cacheService.get<LiquidationHeatmap>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get current price for the symbol
    const ticker = await ccxtService.getTicker(exchange, symbol);
    const currentPrice = ticker?.last || 0;

    if (currentPrice === 0) {
      throw new ExchangeError(
        ErrorCode.NOT_FOUND_TICKER,
        `Could not get current price for ${symbol}`,
        exchange
      );
    }

    // Calculate price range
    const rangePercent = LIQUIDATION_CONFIG.HEATMAP_PRICE_RANGE_PERCENT / 100;
    const priceMin = currentPrice * (1 - rangePercent);
    const priceMax = currentPrice * (1 + rangePercent);
    const bucketSize = (priceMax - priceMin) / bucketCount;

    // Fetch recent liquidations
    const liquidations = await this.getLiquidations(
      exchange,
      symbol.replace('.P', '').replace('-', ''),
      LIQUIDATION_CONFIG.MAX_LIMIT
    );

    // Initialize buckets
    const buckets: LiquidationBucket[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const bucketMin = priceMin + i * bucketSize;
      const bucketMax = priceMin + (i + 1) * bucketSize;
      const bucketCenter = (bucketMin + bucketMax) / 2;

      buckets.push({
        priceMin: bucketMin,
        priceMax: bucketMax,
        priceCenter: bucketCenter,
        longCount: 0,
        longValue: 0,
        shortCount: 0,
        shortValue: 0,
        totalCount: 0,
        totalValue: 0,
        intensity: 0,
        distanceFromPrice: ((bucketCenter - currentPrice) / currentPrice) * 100,
      });
    }

    // Assign liquidations to buckets
    for (const liq of liquidations) {
      if (liq.price < priceMin || liq.price >= priceMax) continue;

      const bucketIndex = Math.floor((liq.price - priceMin) / bucketSize);
      if (bucketIndex < 0 || bucketIndex >= bucketCount) continue;

      const bucket = buckets[bucketIndex];
      if (liq.side === 'long') {
        bucket.longCount++;
        bucket.longValue += liq.value;
      } else {
        bucket.shortCount++;
        bucket.shortValue += liq.value;
      }
      bucket.totalCount++;
      bucket.totalValue += liq.value;
    }

    // Calculate normalized intensity
    const maxValue = Math.max(...buckets.map((b) => b.totalValue), 1);
    for (const bucket of buckets) {
      bucket.intensity = bucket.totalValue / maxValue;
    }

    const heatmap: LiquidationHeatmap = {
      symbol,
      exchange,
      currentPrice,
      priceRange: { min: priceMin, max: priceMax },
      buckets,
      meta: {
        bucketCount,
        totalLiquidations: liquidations.length,
        totalValue: liquidations.reduce((sum, l) => sum + l.value, 0),
        timestamp: Date.now(),
      },
    };

    cacheService.set(cacheKey, heatmap, LIQUIDATION_CONFIG.CACHE_TTL_HEATMAP);

    return heatmap;
  }

  /**
   * Get active cascade alerts
   */
  async getCascadeAlerts(threshold?: number): Promise<CascadeAlert[]> {
    // Trigger cascade detection by fetching latest data
    await Promise.allSettled(
      LIQUIDATION_CONFIG.SUPPORTED_EXCHANGES.map((exchange) =>
        this.getLiquidations(exchange, undefined, 100)
      )
    );

    const cascades = Array.from(memoryStore.cascades.values());

    // Filter by threshold if provided
    if (threshold) {
      return cascades.filter((c) => c.totalValue >= threshold);
    }

    // Return active cascades sorted by value
    return cascades.filter((c) => c.isActive).sort((a, b) => b.totalValue - a.totalValue);
  }

  /**
   * Get high-risk liquidation zones based on recent liquidation clusters
   */
  async getLiquidationZones(exchange: string, symbol: string): Promise<LiquidationZone[]> {
    const cacheKey = `liquidations:zones:${exchange}:${symbol}`;
    const cached = cacheService.get<LiquidationZone[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get heatmap data for zone calculation
    const heatmap = await this.getLiquidationHeatmap(exchange, symbol, 20);

    const zones: LiquidationZone[] = [];

    // Find clusters of high liquidation activity
    for (let i = 0; i < heatmap.buckets.length; i++) {
      const bucket = heatmap.buckets[i];

      // Skip low-activity buckets
      if (bucket.intensity < 0.3) continue;

      // Determine zone type based on which side has more liquidations
      const type: LiquidationZone['type'] =
        bucket.longValue > bucket.shortValue ? 'long_liquidation_zone' : 'short_liquidation_zone';

      // Determine risk level
      let risk: LiquidationZone['risk'];
      if (bucket.intensity >= 0.8) {
        risk = 'extreme';
      } else if (bucket.intensity >= 0.6) {
        risk = 'high';
      } else if (bucket.intensity >= 0.4) {
        risk = 'medium';
      } else {
        risk = 'low';
      }

      zones.push({
        id: `${exchange}-${symbol}-zone-${i}`,
        type,
        priceMin: bucket.priceMin,
        priceMax: bucket.priceMax,
        estimatedValue: bucket.totalValue,
        risk,
        distanceFromPrice: Math.abs(bucket.distanceFromPrice),
        distancePercent: bucket.distanceFromPrice,
      });
    }

    // Sort by proximity to current price
    zones.sort((a, b) => a.distanceFromPrice - b.distanceFromPrice);

    cacheService.set(cacheKey, zones, LIQUIDATION_CONFIG.CACHE_TTL_ZONES);

    return zones;
  }

  /**
   * Get live liquidation feed with rolling statistics
   */
  async getLiveFeed(
    exchange: string,
    symbol?: string,
    limit: number = 50
  ): Promise<LiveLiquidationFeed> {
    const events = await this.getLiquidations(exchange, symbol, limit);
    const cascades = await this.getCascadeAlerts();

    const now = Date.now();

    // Calculate rolling summaries
    const last1m = events.filter((e) => now - e.timestamp < 60000);
    const last5m = events.filter((e) => now - e.timestamp < 300000);
    const last15m = events.filter((e) => now - e.timestamp < 900000);

    return {
      events,
      summary: {
        last1m: {
          count: last1m.length,
          value: last1m.reduce((sum, e) => sum + e.value, 0),
        },
        last5m: {
          count: last5m.length,
          value: last5m.reduce((sum, e) => sum + e.value, 0),
        },
        last15m: {
          count: last15m.length,
          value: last15m.reduce((sum, e) => sum + e.value, 0),
        },
      },
      cascades: cascades.filter((c) => c.exchange === exchange && (!symbol || c.symbol === symbol)),
      timestamp: now,
    };
  }
}

// Export singleton instance
export const liquidationService = new LiquidationService();
