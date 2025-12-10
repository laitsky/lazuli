/**
 * Liquidation Routes for Elysia
 *
 * Real-time liquidation monitoring endpoints for perpetual futures exchanges.
 * Provides live liquidation feed, statistics, heatmaps, cascade alerts, and risk zones.
 *
 * Base path: /api/v1/liquidations
 *
 * Endpoints:
 * - GET /supported - List supported exchanges for liquidation data
 * - GET /aggregate/:symbol - Cross-exchange liquidation aggregation
 * - GET /stats/:exchange - Liquidation statistics and analytics
 * - GET /heatmap/:exchange/:symbol - Price-level liquidation density
 * - GET /cascades - Active cascade alerts
 * - GET /zones/:exchange/:symbol - High-risk liquidation zones
 * - GET /feed/:exchange - Live liquidation feed with rolling stats
 * - GET /ws/status - WebSocket connection status
 * - GET /:exchange/:symbol - Get liquidations for specific symbol
 * - GET /:exchange - Get recent liquidations for an exchange
 */

import { Elysia, t } from 'elysia';
import { liquidationService } from '../services/liquidationService';
import { liquidationWebSocketService } from '../services/liquidationWebSocketService';
import { successResponse } from '../utils/response';
import { validateInteger, validateSearchQuery } from '../utils/validation';
import { invalidExchange } from '../errors';
import { LiquidationExchange } from '@lazuli/shared';

/**
 * Validate liquidation exchange (perpetual-only exchanges)
 * Liquidation data is only available from perpetual futures exchanges
 */
function validateLiquidationExchange(value: any): LiquidationExchange | null {
  const normalized = String(value).toLowerCase();

  if (liquidationService.isExchangeSupported(normalized)) {
    return normalized as LiquidationExchange;
  }

  return null;
}

/**
 * Validate statistics period
 */
function validatePeriod(value: any): '1h' | '4h' | '24h' {
  if (value === '1h' || value === '4h' || value === '24h') {
    return value;
  }
  return '24h'; // Default to 24 hours
}

/**
 * Liquidation routes plugin
 */
export const liquidationRoutes = new Elysia({ prefix: '/liquidations' })
  /**
   * GET /api/v1/liquidations/supported
   * List exchanges that support liquidation data
   */
  .get('/supported', async () => {
    const exchanges = liquidationService.getSupportedExchanges();
    return successResponse({
      exchanges,
      count: exchanges.length,
      timestamp: Date.now(),
    });
  })

  /**
   * GET /api/v1/liquidations/aggregate/:symbol
   * Cross-exchange liquidation aggregation for a symbol
   * Combines data from all supported exchanges for comprehensive view
   *
   * @param symbol - Trading pair symbol (e.g., "BTCUSDT")
   * @query limit - Maximum number of liquidations to return (default: 50, max: 200)
   */
  .get(
    '/aggregate/:symbol',
    async ({ params, query }) => {
      const symbol = decodeURIComponent(params.symbol).toUpperCase();
      const limit = validateInteger(query.limit, 50, 1, 200);

      const aggregated = await liquidationService.getAllExchangeLiquidations(symbol, limit);

      return successResponse(aggregated);
    },
    {
      params: t.Object({
        symbol: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
    }
  )

  /**
   * GET /api/v1/liquidations/stats/:exchange
   * Liquidation statistics and analytics for an exchange
   * Includes volume, counts, long/short ratio, intensity, top symbols
   *
   * @param exchange - Exchange identifier (binance, bybit, okx, hyperliquid)
   * @query period - Time period: '1h', '4h', '24h' (default: '24h')
   * @query symbol - Optional symbol filter
   */
  .get(
    '/stats/:exchange',
    async ({ params, query }) => {
      const exchangeId = validateLiquidationExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      const period = validatePeriod(query.period);
      const symbol = validateSearchQuery(query.symbol);

      const stats = await liquidationService.getLiquidationStats(exchangeId, symbol, period);

      return successResponse(stats);
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
      query: t.Object({
        period: t.Optional(t.String()),
        symbol: t.Optional(t.String()),
      }),
    }
  )

  /**
   * GET /api/v1/liquidations/heatmap/:exchange/:symbol
   * Price-level liquidation density for heatmap visualization
   * Shows where liquidations cluster at different price levels
   *
   * @param exchange - Exchange identifier
   * @param symbol - Trading pair symbol (e.g., "BTCUSDT.P")
   * @query buckets - Number of price buckets (default: 50, min: 10, max: 100)
   */
  .get(
    '/heatmap/:exchange/:symbol',
    async ({ params, query }) => {
      const exchangeId = validateLiquidationExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      const symbol = decodeURIComponent(params.symbol);
      const buckets = validateInteger(query.buckets, 50, 10, 100);

      const heatmap = await liquidationService.getLiquidationHeatmap(exchangeId, symbol, buckets);

      return successResponse(heatmap);
    },
    {
      params: t.Object({
        exchange: t.String(),
        symbol: t.String(),
      }),
      query: t.Object({
        buckets: t.Optional(t.String()),
      }),
    }
  )

  /**
   * GET /api/v1/liquidations/cascades
   * Active liquidation cascade alerts across all exchanges
   * Triggered when liquidation volume exceeds threshold in short time window
   *
   * @query threshold - Minimum USD value to trigger cascade (default: $1M, min: $100K, max: $10M)
   */
  .get(
    '/cascades',
    async ({ query }) => {
      const threshold = validateInteger(query.threshold, 1000000, 100000, 10000000);

      const cascades = await liquidationService.getCascadeAlerts(threshold);

      return successResponse({
        cascades,
        count: cascades.length,
        threshold,
        timestamp: Date.now(),
      });
    },
    {
      query: t.Object({
        threshold: t.Optional(t.String()),
      }),
    }
  )

  /**
   * GET /api/v1/liquidations/zones/:exchange/:symbol
   * High-risk liquidation price zones
   * Identifies areas with historically high liquidation activity
   *
   * @param exchange - Exchange identifier
   * @param symbol - Trading pair symbol
   */
  .get(
    '/zones/:exchange/:symbol',
    async ({ params }) => {
      const exchangeId = validateLiquidationExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      const symbol = decodeURIComponent(params.symbol);

      const zones = await liquidationService.getLiquidationZones(exchangeId, symbol);

      return successResponse({
        zones,
        count: zones.length,
        exchange: exchangeId,
        symbol,
        timestamp: Date.now(),
      });
    },
    {
      params: t.Object({
        exchange: t.String(),
        symbol: t.String(),
      }),
    }
  )

  /**
   * GET /api/v1/liquidations/feed/:exchange
   * Live liquidation feed with rolling statistics
   * Includes recent events, 1m/5m/15m summaries, and active cascades
   *
   * @param exchange - Exchange identifier
   * @query symbol - Optional symbol filter
   * @query limit - Maximum events to return (default: 50, max: 100)
   */
  .get(
    '/feed/:exchange',
    async ({ params, query }) => {
      const exchangeId = validateLiquidationExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      const symbol = validateSearchQuery(query.symbol);
      const limit = validateInteger(query.limit, 50, 1, 100);

      const feed = await liquidationService.getLiveFeed(exchangeId, symbol, limit);

      return successResponse(feed);
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
      query: t.Object({
        symbol: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  /**
   * GET /api/v1/liquidations/ws/status
   * WebSocket connection status for all exchanges
   * Returns connection state and last message time for each exchange
   */
  .get('/ws/status', async () => {
    const status = liquidationWebSocketService.getStatus();
    const recentEvents = liquidationWebSocketService.getRecentEvents(10);

    return successResponse({
      connections: status,
      recentEventsCount: recentEvents.length,
      isConnected: liquidationWebSocketService.isConnected(),
      timestamp: Date.now(),
    });
  })

  /**
   * GET /api/v1/liquidations/:exchange/:symbol
   * Get liquidations for a specific trading pair
   *
   * @param exchange - Exchange identifier
   * @param symbol - Trading pair symbol (e.g., "BTCUSDT")
   * @query limit - Maximum number of liquidations (default: 100, max: 500)
   * @query since - Timestamp in ms to fetch liquidations since (optional)
   */
  .get(
    '/:exchange/:symbol',
    async ({ params, query }) => {
      const exchangeId = validateLiquidationExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      // Check that symbol is not a reserved route
      const symbol = decodeURIComponent(params.symbol);
      if (
        ['supported', 'aggregate', 'stats', 'heatmap', 'cascades', 'zones', 'feed', 'ws'].includes(
          symbol.toLowerCase()
        )
      ) {
        throw invalidExchange(symbol);
      }

      const limit = validateInteger(query.limit, 100, 1, 500);
      const since = query.since ? parseInt(query.since, 10) : undefined;

      const liquidations = await liquidationService.getLiquidations(
        exchangeId,
        symbol.toUpperCase(),
        limit,
        since
      );

      return successResponse({
        exchange: exchangeId,
        symbol: symbol.toUpperCase(),
        liquidations,
        count: liquidations.length,
        timestamp: Date.now(),
      });
    },
    {
      params: t.Object({
        exchange: t.String(),
        symbol: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        since: t.Optional(t.String()),
      }),
    }
  )

  /**
   * GET /api/v1/liquidations/:exchange
   * Get recent liquidations from an exchange (all symbols)
   *
   * @param exchange - Exchange identifier
   * @query limit - Maximum number of liquidations (default: 100, max: 500)
   * @query symbol - Optional symbol filter
   * @query since - Timestamp in ms to fetch liquidations since (optional)
   */
  .get(
    '/:exchange',
    async ({ params, query }) => {
      const exchangeId = validateLiquidationExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      const limit = validateInteger(query.limit, 100, 1, 500);
      const symbol = validateSearchQuery(query.symbol);
      const since = query.since ? parseInt(query.since, 10) : undefined;

      const liquidations = await liquidationService.getLiquidations(
        exchangeId,
        symbol,
        limit,
        since
      );

      return successResponse({
        exchange: exchangeId,
        symbol: symbol || 'all',
        liquidations,
        count: liquidations.length,
        timestamp: Date.now(),
      });
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        symbol: t.Optional(t.String()),
        since: t.Optional(t.String()),
      }),
    }
  );
