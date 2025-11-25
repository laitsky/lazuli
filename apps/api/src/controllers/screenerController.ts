/**
 * Screener Controller - API handlers for Alt Screener feature
 *
 * This controller handles HTTP requests for the Alt Screener endpoints:
 * - GET /api/v1/screener/:exchange - Get all altcoins with performance data
 *
 * The Alt Screener allows traders to:
 * - View all altcoins (excluding BTC) on a single page
 * - Compare performance against USD, BTC, ETH, or SOL
 * - Sort by performance, volume, price, or name
 * - Filter by volume range, performance range, and search query
 * - View mini charts (sparklines) for each altcoin
 */

import { Request, Response } from 'express';
import { screenerService } from '../services/screenerService';
import { successResponse, errorResponse } from '../utils/response';
import {
  validateExchange,
  validateInteger,
  validateSearchQuery,
  validateSortOrder,
  validateMarketType,
} from '../utils/validation';
import { BaseCurrency, PerformancePeriod, ScreenerSortBy, ScreenerFilters } from '@lazuli/shared';

/**
 * Valid base currencies for comparison
 */
const VALID_BASE_CURRENCIES: BaseCurrency[] = ['USD', 'BTC', 'ETH', 'SOL'];

/**
 * Valid performance periods
 */
const VALID_PERIODS: PerformancePeriod[] = ['1h', '4h', '24h', '7d', '30d'];

/**
 * Valid sort fields
 */
const VALID_SORT_BY: ScreenerSortBy[] = ['performance', 'volume', 'price', 'name'];

/**
 * Validate base currency parameter
 * @param value - Input value
 * @returns Valid base currency or 'USD' as default
 */
function validateBaseCurrency(value: any): BaseCurrency {
  const normalized = String(value).toUpperCase();
  if (VALID_BASE_CURRENCIES.includes(normalized as BaseCurrency)) {
    return normalized as BaseCurrency;
  }
  return 'USD';
}

/**
 * Validate performance period parameter
 * @param value - Input value
 * @returns Valid period or '24h' as default
 */
function validatePeriod(value: any): PerformancePeriod {
  const normalized = String(value).toLowerCase();
  if (VALID_PERIODS.includes(normalized as PerformancePeriod)) {
    return normalized as PerformancePeriod;
  }
  return '24h';
}

/**
 * Validate sort by parameter
 * @param value - Input value
 * @returns Valid sort field or 'performance' as default
 */
function validateScreenerSortBy(value: any): ScreenerSortBy {
  const normalized = String(value).toLowerCase();
  if (VALID_SORT_BY.includes(normalized as ScreenerSortBy)) {
    return normalized as ScreenerSortBy;
  }
  return 'performance';
}

/**
 * Validate number parameter (for min/max filters)
 * @param value - Input value
 * @returns Parsed number or undefined if invalid
 */
function validateNumber(value: any): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const parsed = parseFloat(String(value));
  if (isNaN(parsed) || !isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export class ScreenerController {
  /**
   * Get all altcoins with performance data for the Alt Screener
   *
   * This endpoint fetches all altcoins (excluding BTC and stablecoins) from an exchange
   * and returns performance data including:
   * - Current price in USD and relative to selected base currency
   * - Performance changes (1h, 4h, 24h, 7d)
   * - 24h volume and high/low prices
   * - Mini OHLCV data for sparkline charts
   * - Aggregate statistics (gainers, losers, average change)
   *
   * Query parameters:
   * - base: Base currency for comparison (USD, BTC, ETH, SOL, default: USD)
   * - period: Performance period (1h, 4h, 24h, 7d, 30d, default: 24h)
   * - sortBy: Sort field (performance, volume, price, name, default: performance)
   * - sortOrder: Sort direction (asc, desc, default: desc)
   * - limit: Maximum number of results (default: 100, max: 500)
   * - minVolume: Minimum 24h volume filter
   * - maxVolume: Maximum 24h volume filter
   * - minChange: Minimum percentage change filter
   * - maxChange: Maximum percentage change filter
   * - type: Market type filter (spot, perp)
   * - search: Symbol search query
   *
   * @param req - Express request with exchange parameter and query params
   * @param res - Express response object
   * @returns Response with alt screener data
   */
  async getAltcoins(req: Request, res: Response): Promise<Response> {
    try {
      // Validate exchange parameter
      const exchangeId = validateExchange(req.params.exchange);

      if (!exchangeId) {
        return errorResponse(
          res,
          `Exchange "${req.params.exchange}" not supported. ` +
            `Supported exchanges: binance, bybit, okx`,
          400
        );
      }

      // Hyperliquid only has perpetual markets, not ideal for altcoin screener
      if (exchangeId === 'hyperliquid') {
        return errorResponse(
          res,
          'Hyperliquid only supports perpetual markets. ' +
            'For altcoin screening, please use binance, bybit, or okx.',
          400
        );
      }

      // Validate query parameters
      const baseCurrency = validateBaseCurrency(req.query.base);
      const period = validatePeriod(req.query.period);
      const sortBy = validateScreenerSortBy(req.query.sortBy);
      const sortOrder = validateSortOrder(req.query.sortOrder);
      const limit = validateInteger(req.query.limit, 100, 1, 500);

      // Build filters object
      const filters: ScreenerFilters = {};
      const minVolume = validateNumber(req.query.minVolume);
      const maxVolume = validateNumber(req.query.maxVolume);
      const minChange = validateNumber(req.query.minChange);
      const maxChange = validateNumber(req.query.maxChange);
      const typeFilter = validateMarketType(req.query.type);
      const searchQuery = validateSearchQuery(req.query.search, 50);

      if (minVolume !== undefined) filters.minVolume = minVolume;
      if (maxVolume !== undefined) filters.maxVolume = maxVolume;
      if (minChange !== undefined) filters.minChange = minChange;
      if (maxChange !== undefined) filters.maxChange = maxChange;
      if (typeFilter) filters.type = typeFilter;
      if (searchQuery) filters.search = searchQuery;

      // Get altcoin data from screener service
      const screenerData = await screenerService.getAltcoins(
        exchangeId,
        baseCurrency,
        period,
        sortBy,
        sortOrder,
        limit,
        Object.keys(filters).length > 0 ? filters : undefined
      );

      return successResponse(res, screenerData);
    } catch (error) {
      console.error('Error in getAltcoins:', error);
      return errorResponse(
        res,
        `Failed to fetch altcoin data: ${error instanceof Error ? error.message : error}`,
        500
      );
    }
  }

  /**
   * Get quick stats for the Alt Screener
   * Lightweight endpoint that returns just the stats without OHLCV data
   *
   * @param req - Express request with exchange parameter
   * @param res - Express response object
   * @returns Response with screener stats
   */
  async getStats(req: Request, res: Response): Promise<Response> {
    try {
      // Validate exchange parameter
      const exchangeId = validateExchange(req.params.exchange);

      if (!exchangeId) {
        return errorResponse(res, `Exchange "${req.params.exchange}" not supported`, 400);
      }

      // Get minimal data with small limit for quick stats
      const screenerData = await screenerService.getAltcoins(
        exchangeId,
        'USD',
        '24h',
        'performance',
        'desc',
        10 // Only need a few for stats
      );

      // Return just the stats
      return successResponse(res, {
        exchange: screenerData.exchange,
        stats: screenerData.stats,
        timestamp: screenerData.timestamp,
      });
    } catch (error) {
      console.error('Error in getStats:', error);
      return errorResponse(res, `Failed to fetch stats: ${error}`, 500);
    }
  }
}

// Export singleton instance for use in routes
export const screenerController = new ScreenerController();
