/**
 * Screener Routes for Elysia
 * API handlers for Alt Screener feature
 *
 * The Alt Screener allows traders to:
 * - View all altcoins (excluding BTC) on a single page
 * - Compare performance against USD, BTC, ETH, or SOL
 * - Sort by performance, volume, price, or name
 * - Filter by volume range, performance range, and search query
 */

import { Elysia, t } from 'elysia';
import { screenerService } from '../services/screenerService';
import { successResponse } from '../utils/response';
import {
  validateExchange,
  validateInteger,
  validateSearchQuery,
  validateSortOrder,
  validateMarketType,
} from '../utils/validation';
import { BaseCurrency, PerformancePeriod, ScreenerSortBy, ScreenerFilters } from '@lazuli/shared';
import { invalidExchange, invalidParameter } from '../errors';

// Valid options
const VALID_BASE_CURRENCIES: BaseCurrency[] = ['USD', 'BTC', 'ETH', 'SOL'];
const VALID_PERIODS: PerformancePeriod[] = ['1h', '4h', '24h', '7d', '30d'];
const VALID_SORT_BY: ScreenerSortBy[] = ['performance', 'volume', 'price', 'name'];

/**
 * Validate base currency parameter
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

/**
 * Screener routes plugin
 */
export const screenerRoutes = new Elysia({ prefix: '/screener' })
  // GET /api/v1/screener/:exchange/stats - Get quick stats (must be before :exchange route)
  .get(
    '/:exchange/stats',
    async ({ params }) => {
      const exchangeId = validateExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      // Get minimal data with small limit for quick stats
      const screenerData = await screenerService.getAltcoins(
        exchangeId,
        'USD',
        '24h',
        'performance',
        'desc',
        10
      );

      return successResponse({
        exchange: screenerData.exchange,
        stats: screenerData.stats,
        timestamp: screenerData.timestamp,
      });
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
    }
  )
  // GET /api/v1/screener/:exchange - Get all altcoins with performance data
  .get(
    '/:exchange',
    async ({ params, query }) => {
      const exchangeId = validateExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      // Hyperliquid only has perpetual markets
      if (exchangeId === 'hyperliquid') {
        throw invalidParameter(
          'exchange',
          'Hyperliquid only supports perpetual markets. For altcoin screening, please use binance, bybit, okx, or upbit.'
        );
      }

      // Validate query parameters
      const baseCurrency = validateBaseCurrency(query.base);
      const period = validatePeriod(query.period);
      const sortBy = validateScreenerSortBy(query.sortBy);
      const sortOrder = validateSortOrder(query.sortOrder);
      const limit = validateInteger(query.limit, 100, 1, 500);

      // Build filters object
      const filters: ScreenerFilters = {};
      const minVolume = validateNumber(query.minVolume);
      const maxVolume = validateNumber(query.maxVolume);
      const minChange = validateNumber(query.minChange);
      const maxChange = validateNumber(query.maxChange);
      const typeFilter = validateMarketType(query.type);
      const searchQuery = validateSearchQuery(query.search, 50);

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

      return successResponse(screenerData);
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
      query: t.Object({
        base: t.Optional(t.String()),
        period: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortOrder: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        minVolume: t.Optional(t.String()),
        maxVolume: t.Optional(t.String()),
        minChange: t.Optional(t.String()),
        maxChange: t.Optional(t.String()),
        type: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    }
  );
