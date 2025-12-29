/**
 * Order Book Routes for Elysia
 * Routes requests to exchange services for bid/ask order data
 */

import { Elysia, t } from 'elysia';
import { ccxtService } from '../services/ccxtService';
import { cacheService } from '../services/cacheService';
import { successResponse } from '../utils/response';
import { OrderBookResponse } from '@lazuli/shared';
import { createServiceLogger } from '../utils/logger';
import { validateExchange, validateInteger } from '../utils/validation';

// Create logger for order book routes
const log = createServiceLogger('orderBook');
import { invalidExchange, invalidMarketType, missingParameter } from '../errors';

/**
 * Order book routes plugin
 */
export const orderBookRoutes = new Elysia({ prefix: '/orderbook' })
  // GET /api/v1/orderbook/:exchange/:symbol - Get order book data
  .get(
    '/:exchange/:symbol',
    async ({ params, query }) => {
      const exchangeId = validateExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      if (!params.symbol) {
        throw missingParameter('symbol');
      }

      // Validate market type parameter
      let marketType = (query.type as 'spot' | 'perp') || 'spot';
      if (marketType !== 'spot' && marketType !== 'perp') {
        throw invalidMarketType(String(query.type));
      }

      // Auto-correct for exchange-specific limitations
      if (exchangeId === 'hyperliquid' && marketType === 'spot') {
        marketType = 'perp';
      }
      if (exchangeId === 'upbit' && marketType === 'perp') {
        marketType = 'spot';
      }

      // Validate limit parameter (1-500, default 50)
      const limit = validateInteger(query.limit, 50, 1, 500);

      // Create cache key
      const cacheKey = `orderbook:${exchangeId}:${params.symbol}:${marketType}:${limit}`;
      let orderBook = await cacheService.getAsync<any>(cacheKey);

      if (!orderBook) {
        log.debug('Cache miss, fetching from exchange', { cacheKey });
        orderBook = await ccxtService.fetchOrderBook(exchangeId, params.symbol, marketType, limit);
        // Cache for 5 seconds (order book changes very rapidly)
        cacheService.set(cacheKey, orderBook, 5000);
      } else {
        log.debug('Cache hit', { cacheKey });
      }

      // Calculate spread and mid price
      const bestBid = orderBook.bids.length > 0 ? orderBook.bids[0].price : null;
      const bestAsk = orderBook.asks.length > 0 ? orderBook.asks[0].price : null;

      let spread: number | null = null;
      let spreadPercent: number | null = null;
      let midPrice: number | null = null;

      if (bestBid !== null && bestAsk !== null) {
        spread = bestAsk - bestBid;
        midPrice = (bestBid + bestAsk) / 2;
        spreadPercent = (spread / midPrice) * 100;
      }

      // Build response
      const response: OrderBookResponse = {
        exchange: exchangeId,
        symbol: params.symbol,
        type: marketType,
        orderbook: orderBook,
        depth: limit,
        spread,
        spreadPercent,
        midPrice,
        timestamp: Date.now(),
      };

      return successResponse(response);
    },
    {
      params: t.Object({
        exchange: t.String(),
        symbol: t.String(),
      }),
      query: t.Object({
        type: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  );
