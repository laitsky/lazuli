/**
 * Ticker Routes for Elysia
 * Handles ticker and market data endpoints
 */

import { Elysia, t } from 'elysia';
import { ccxtService } from '../services/ccxtService';
import { cacheService } from '../services/cacheService';
import { successResponse } from '../utils/response';
import { Ticker, PaginationMeta } from '@lazuli/shared';
import { createServiceLogger } from '../utils/logger';
import {
  validateInteger,
  validateSearchQuery,
  validateMarketType,
  validateSortOrder,
  validateTickerSortBy,
  validateBoolean,
  validateExchange,
  validateQuoteCurrency,
  parseSymbol,
} from '../utils/validation';
import { invalidExchange, tickerNotFound } from '../errors';

// Create logger for ticker routes
const log = createServiceLogger('tickers');

/** Cache TTL for tickers - slightly longer than worker poll interval */
const TICKER_CACHE_TTL = 10000;

/**
 * Get all tickers for an exchange from cache, with fallback to direct fetch
 * Used by both list and single ticker endpoints to avoid code duplication
 *
 * @param exchangeId - The validated exchange identifier
 * @returns Array of all tickers for the exchange
 */
async function getTickersWithCacheFallback(exchangeId: string): Promise<Ticker[]> {
  const cacheKey = `tickers:${exchangeId}:raw`;
  let tickers = await cacheService.getAsync<Ticker[]>(cacheKey);

  // Cache is populated by MarketDataWorker every 5 seconds
  // Fallback to direct fetch only on cold start (cache miss)
  if (!tickers) {
    log.debug('Cache miss (cold start), fetching from exchange', {
      cacheKey,
      exchange: exchangeId,
    });
    tickers = await ccxtService.getAllTickers(exchangeId);
    // Cache with TTL slightly longer than worker interval
    cacheService.set(cacheKey, tickers, TICKER_CACHE_TTL);
  } else {
    log.debug('Cache hit', { cacheKey });
  }

  return tickers;
}

/**
 * Sort tickers by specified field and order
 */
function sortTickers(tickers: Ticker[], sortBy: string, sortOrder: 'asc' | 'desc'): Ticker[] {
  const sorted = [...tickers].sort((a, b) => {
    let aValue: number | null = null;
    let bValue: number | null = null;

    switch (sortBy) {
      case 'volume':
        aValue = a.quoteVolume24h;
        bValue = b.quoteVolume24h;
        break;
      case 'price':
        aValue = a.last;
        bValue = b.last;
        break;
      case 'change':
        aValue = a.percentage24h;
        bValue = b.percentage24h;
        break;
      default:
        aValue = a.quoteVolume24h;
        bValue = b.quoteVolume24h;
    }

    // Handle null values (put them at the end)
    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return 1;
    if (bValue === null) return -1;

    return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
  });

  return sorted;
}

/**
 * Ticker routes plugin
 */
export const tickerRoutes = new Elysia()
  // GET /api/v1/tickers/:exchange - Get all tickers for an exchange
  .get(
    '/tickers/:exchange',
    async ({ params, query }) => {
      // Validate and normalize exchange parameter
      const exchangeId = validateExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      // Validate query parameters with proper bounds and sanitization
      const page = validateInteger(query.page, 1, 1, 10000);
      const limit = validateInteger(query.limit, 100, 1, 500);
      const typeFilter = validateMarketType(query.type);
      const quoteFilter = validateQuoteCurrency(query.quote);
      const searchQuery = validateSearchQuery(query.search, 50);
      const sortBy = validateTickerSortBy(query.sortBy);
      const sortOrder = validateSortOrder(query.sortOrder);

      // Get tickers from cache (or fallback to direct fetch on cold start)
      const allTickers = await getTickersWithCacheFallback(exchangeId);

      // Apply filters
      let filteredTickers = allTickers;

      // Filter by type (spot/perp)
      if (typeFilter && (typeFilter === 'spot' || typeFilter === 'perp')) {
        filteredTickers = filteredTickers.filter((t) => t.type === typeFilter);
      }

      // Filter by quote currency
      if (quoteFilter) {
        filteredTickers = filteredTickers.filter((t) => {
          const { quote } = parseSymbol(t.symbol);
          return quote.toUpperCase() === quoteFilter;
        });
      }

      // Filter by search query (symbol)
      if (searchQuery) {
        filteredTickers = filteredTickers.filter((t) =>
          t.symbol.toLowerCase().includes(searchQuery)
        );
      }

      // Apply sorting
      filteredTickers = sortTickers(filteredTickers, sortBy, sortOrder);

      // Calculate pagination
      const total = filteredTickers.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;

      // Get paginated slice
      const paginatedTickers = filteredTickers.slice(startIndex, endIndex);

      // Build pagination metadata
      const pagination: PaginationMeta = {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };

      // Return structured response
      const response = {
        exchange: exchangeId,
        tickers: paginatedTickers,
        count: paginatedTickers.length,
        pagination,
        filters: {
          type: typeFilter,
          quote: quoteFilter,
          search: searchQuery,
          sortBy,
          sortOrder,
        },
      };

      return successResponse(response);
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        type: t.Optional(t.String()),
        quote: t.Optional(t.String()),
        search: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortOrder: t.Optional(t.String()),
      }),
    }
  )
  // GET /api/v1/tickers/:exchange/:symbol - Get specific ticker data
  .get(
    '/tickers/:exchange/:symbol',
    async ({ params }) => {
      const exchangeId = validateExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      // Get tickers from cache (or fallback to direct fetch on cold start)
      const allTickers = await getTickersWithCacheFallback(exchangeId);

      // Find the specific ticker in the cached list
      const ticker = allTickers.find((t) => t.symbol === params.symbol);

      if (!ticker) {
        throw tickerNotFound(params.symbol, params.exchange);
      }

      return successResponse(ticker);
    },
    {
      params: t.Object({
        exchange: t.String(),
        symbol: t.String(),
      }),
    }
  )
  // GET /api/v1/markets/:exchange - Get all markets for an exchange
  .get(
    '/markets/:exchange',
    async ({ params, query }) => {
      // Validate and normalize exchange parameter
      const exchangeId = validateExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      // Validate query parameters
      const page = validateInteger(query.page, 1, 1, 10000);
      const limit = validateInteger(query.limit, 100, 1, 500);
      const typeFilter = validateMarketType(query.type);
      const searchQuery = validateSearchQuery(query.search, 50);
      const activeFilter = validateBoolean(query.active);

      // Cache key is exchange-specific only
      const cacheKey = `markets:${exchangeId}:raw`;
      let allMarkets = await cacheService.getAsync<any[]>(cacheKey);

      // If not cached, fetch from exchange
      if (!allMarkets) {
        log.debug('Cache miss, fetching markets', { cacheKey, exchange: exchangeId });
        allMarkets = await ccxtService.getMarkets(exchangeId);
        // Cache the raw results for 5 minutes
        cacheService.set(cacheKey, allMarkets, 300000);
      } else {
        log.debug('Cache hit', { cacheKey });
      }

      // Apply filters
      let filteredMarkets = allMarkets;

      // Filter by type (spot/perp)
      if (typeFilter && (typeFilter === 'spot' || typeFilter === 'perp')) {
        filteredMarkets = filteredMarkets.filter((m) => m.type === typeFilter);
      }

      // Filter by active status
      if (activeFilter !== undefined) {
        filteredMarkets = filteredMarkets.filter((m) => m.active === activeFilter);
      }

      // Filter by search query (symbol)
      if (searchQuery) {
        filteredMarkets = filteredMarkets.filter((m) =>
          m.symbol.toLowerCase().includes(searchQuery)
        );
      }

      // Calculate pagination
      const total = filteredMarkets.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;

      // Get paginated slice
      const paginatedMarkets = filteredMarkets.slice(startIndex, endIndex);

      // Build pagination metadata
      const pagination: PaginationMeta = {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };

      // Return structured response
      const response = {
        exchange: exchangeId,
        markets: paginatedMarkets,
        count: paginatedMarkets.length,
        pagination,
        filters: {
          type: typeFilter,
          search: searchQuery,
          active: activeFilter,
        },
      };

      return successResponse(response);
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        type: t.Optional(t.String()),
        search: t.Optional(t.String()),
        active: t.Optional(t.String()),
      }),
    }
  );
