import { Request, Response } from 'express';
import { ccxtService } from '../services/ccxtService';
import { cacheService } from '../services/cacheService';
import { successResponse, handleError } from '../utils/response';
import { OrderBookResponse } from '@lazuli/shared';
import { validateExchange, validateInteger } from '../utils/validation';
import {
  invalidExchange,
  invalidMarketType,
  missingParameter,
} from '../errors';

/**
 * Controller for order book (market depth) endpoints
 * Routes requests to exchange services for bid/ask order data
 */
export class OrderBookController {
  /**
   * Get order book (depth) data for a specific symbol
   *
   * Query parameters:
   * - type: Market type ('spot' or 'perp', default: 'spot')
   * - limit: Number of price levels per side (default: 50, max: 500)
   *
   * @param req - Express request with exchange and symbol parameters
   * @param res - Express response object
   * @returns Response with order book data including bids, asks, spread, and mid price
   */
  async getOrderBook(req: Request, res: Response): Promise<Response> {
    try {
      // Validate and normalize exchange parameter
      const exchangeId = validateExchange(req.params.exchange);

      if (!exchangeId) {
        throw invalidExchange(req.params.exchange);
      }

      // Extract and validate symbol parameter
      const symbol = req.params.symbol;
      if (!symbol) {
        throw missingParameter('symbol');
      }

      // Validate market type parameter
      // Hyperliquid only supports perpetual markets, so auto-correct to 'perp' for Hyperliquid
      let marketType = (req.query.type as 'spot' | 'perp') || 'spot';
      if (marketType !== 'spot' && marketType !== 'perp') {
        throw invalidMarketType(String(req.query.type));
      }

      // Hyperliquid only supports perpetual markets - auto-correct spot requests
      if (exchangeId === 'hyperliquid' && marketType === 'spot') {
        marketType = 'perp'; // Auto-correct to perp since Hyperliquid only has perp markets
      }

      // Upbit only supports spot markets - auto-correct perp requests
      if (exchangeId === 'upbit' && marketType === 'perp') {
        marketType = 'spot'; // Auto-correct to spot since Upbit only has spot markets
      }

      // Validate limit parameter (1-500, default 50)
      const limit = validateInteger(req.query.limit, 50, 1, 500);

      // Create cache key based on all parameters
      // Order book data changes rapidly, so use short cache TTL
      const cacheKey = `orderbook:${exchangeId}:${symbol}:${marketType}:${limit}`;
      let orderBook = cacheService.get<any>(cacheKey);

      // If not cached, fetch from exchange
      if (!orderBook) {
        console.log(`Cache miss for ${cacheKey}, fetching from exchange...`);

        switch (exchangeId) {
          case 'binance':
          case 'bybit':
          case 'okx':
          case 'hyperliquid':
          case 'upbit':
            orderBook = await ccxtService.fetchOrderBook(
              exchangeId,
              symbol,
              marketType,
              limit
            );
            break;
        }

        // Cache for 5 seconds (order book changes very rapidly)
        cacheService.set(cacheKey, orderBook, 5000);
      } else {
        console.log(`Cache hit for ${cacheKey}`);
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

      // Build response matching OrderBookResponse interface
      const response: OrderBookResponse = {
        exchange: exchangeId,
        symbol,
        type: marketType,
        orderbook: orderBook,
        depth: limit,
        spread,
        spreadPercent,
        midPrice,
        timestamp: Date.now(),
      };

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getOrderBook:', error);
      return handleError(res, error, 'Failed to fetch order book data');
    }
  }
}

// Export singleton instance for use in routes
export const orderBookController = new OrderBookController();
