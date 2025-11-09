import { Request, Response } from 'express';
import { ccxtService } from '../services/ccxtService';
import { hyperliquidService } from '../services/hyperliquidService';
import { cacheService } from '../services/cacheService';
import { successResponse, errorResponse } from '../utils/response';
import { SupportedExchange, Timeframe, OHLCVResponse } from '@lazuli/shared';
import { validateExchange, validateInteger } from '../utils/validation';

/**
 * Controller for OHLCV (candlestick) data endpoints
 * Routes requests to appropriate exchange services for historical price data
 */
export class OHLCVController {
  /**
   * Get OHLCV (candlestick) data for a specific symbol and timeframe
   *
   * Query parameters:
   * - timeframe: Timeframe for candles (1m, 5m, 15m, 1h, 4h, 1d, 3d, 1w) - REQUIRED
   * - type: Market type ('spot' or 'perp', default: 'spot')
   * - limit: Number of candles to fetch (default: 100, max: 1000)
   *
   * @param req - Express request with exchange and symbol parameters
   * @param res - Express response object
   * @returns Response with OHLCV candles
   */
  async getOHLCV(req: Request, res: Response): Promise<Response> {
    try {
      // Validate and normalize exchange parameter
      const exchangeId = validateExchange(req.params.exchange);

      if (!exchangeId) {
        return errorResponse(res, `Exchange ${req.params.exchange} not supported`, 400);
      }

      // Extract and validate symbol parameter
      const symbol = req.params.symbol;
      if (!symbol) {
        return errorResponse(res, 'Symbol parameter is required', 400);
      }

      // Validate timeframe parameter
      const timeframe = req.query.timeframe as Timeframe;
      if (!timeframe) {
        return errorResponse(res, 'Timeframe query parameter is required', 400);
      }

      const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];
      if (!validTimeframes.includes(timeframe)) {
        return errorResponse(
          res,
          `Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`,
          400
        );
      }

      // Validate market type parameter
      const marketType = (req.query.type as 'spot' | 'perp') || 'spot';
      if (marketType !== 'spot' && marketType !== 'perp') {
        return errorResponse(res, 'Market type must be "spot" or "perp"', 400);
      }

      // Validate limit parameter
      const limit = validateInteger(req.query.limit, 100, 1, 1000);

      // Create cache key based on all parameters
      const cacheKey = `ohlcv:${exchangeId}:${symbol}:${timeframe}:${marketType}:${limit}`;
      let candles = cacheService.get<any[]>(cacheKey);

      // If not cached, fetch from exchange
      if (!candles) {
        console.log(`Cache miss for ${cacheKey}, fetching from exchange...`);

        switch (exchangeId) {
          case 'binance':
          case 'bybit':
          case 'okx':
            // CCXT exchanges support both spot and perp
            candles = await ccxtService.fetchOHLCV(
              exchangeId,
              symbol,
              timeframe,
              marketType,
              limit
            );
            break;
          case 'hyperliquid':
            // Hyperliquid only supports perpetual markets
            if (marketType === 'spot') {
              return errorResponse(
                res,
                'Hyperliquid only supports perpetual markets (type=perp)',
                400
              );
            }
            candles = await hyperliquidService.fetchOHLCV(symbol, timeframe, limit);
            break;
        }

        // Cache the results for 1 minute (OHLCV data changes frequently)
        cacheService.set(cacheKey, candles, 60000);
      } else {
        console.log(`Cache hit for ${cacheKey}`);
      }

      // Build response matching OHLCVResponse interface
      const response: OHLCVResponse = {
        exchange: exchangeId,
        symbol,
        timeframe,
        candles,
        count: candles.length,
      };

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getOHLCV:', error);
      return errorResponse(res, `Failed to fetch OHLCV data: ${error}`, 500);
    }
  }

  /**
   * Get OHLCV data for multiple timeframes at once
   * Useful for multi-timeframe analysis pages
   *
   * Query parameters:
   * - timeframes: Comma-separated list of timeframes (e.g., "1m,5m,15m,1h") - REQUIRED
   * - type: Market type ('spot' or 'perp', default: 'spot')
   * - limit: Number of candles per timeframe (default: 100, max: 1000)
   *
   * @param req - Express request with exchange and symbol parameters
   * @param res - Express response object
   * @returns Response with OHLCV candles for multiple timeframes
   */
  async getMultiTimeframeOHLCV(req: Request, res: Response): Promise<Response> {
    try {
      // Validate and normalize exchange parameter
      const exchangeId = validateExchange(req.params.exchange);

      if (!exchangeId) {
        return errorResponse(res, `Exchange ${req.params.exchange} not supported`, 400);
      }

      // Extract and validate symbol parameter
      const symbol = req.params.symbol;
      if (!symbol) {
        return errorResponse(res, 'Symbol parameter is required', 400);
      }

      // Validate timeframes parameter
      const timeframesParam = req.query.timeframes as string;
      if (!timeframesParam) {
        return errorResponse(res, 'Timeframes query parameter is required', 400);
      }

      const timeframes = timeframesParam.split(',').map(tf => tf.trim()) as Timeframe[];
      const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

      // Validate each timeframe
      for (const tf of timeframes) {
        if (!validTimeframes.includes(tf)) {
          return errorResponse(
            res,
            `Invalid timeframe "${tf}". Must be one of: ${validTimeframes.join(', ')}`,
            400
          );
        }
      }

      // Limit to max 8 timeframes to prevent abuse
      if (timeframes.length > 8) {
        return errorResponse(res, 'Maximum 8 timeframes allowed per request', 400);
      }

      // Validate market type parameter
      const marketType = (req.query.type as 'spot' | 'perp') || 'spot';
      if (marketType !== 'spot' && marketType !== 'perp') {
        return errorResponse(res, 'Market type must be "spot" or "perp"', 400);
      }

      // Validate limit parameter
      const limit = validateInteger(req.query.limit, 100, 1, 1000);

      // Check if Hyperliquid with spot market (not supported)
      if (exchangeId === 'hyperliquid' && marketType === 'spot') {
        return errorResponse(
          res,
          'Hyperliquid only supports perpetual markets (type=perp)',
          400
        );
      }

      // Fetch OHLCV data for all timeframes in parallel
      const promises = timeframes.map(async (timeframe) => {
        const cacheKey = `ohlcv:${exchangeId}:${symbol}:${timeframe}:${marketType}:${limit}`;
        let candles = cacheService.get<any[]>(cacheKey);

        if (!candles) {
          console.log(`Cache miss for ${cacheKey}, fetching from exchange...`);

          switch (exchangeId) {
            case 'binance':
            case 'bybit':
            case 'okx':
              candles = await ccxtService.fetchOHLCV(
                exchangeId,
                symbol,
                timeframe,
                marketType,
                limit
              );
              break;
            case 'hyperliquid':
              candles = await hyperliquidService.fetchOHLCV(symbol, timeframe, limit);
              break;
          }

          // Cache the results for 1 minute
          cacheService.set(cacheKey, candles, 60000);
        } else {
          console.log(`Cache hit for ${cacheKey}`);
        }

        return {
          timeframe,
          candles,
          count: candles.length,
        };
      });

      const results = await Promise.all(promises);

      // Build response with data for each timeframe
      const response = {
        exchange: exchangeId,
        symbol,
        marketType,
        timeframes: results,
      };

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getMultiTimeframeOHLCV:', error);
      return errorResponse(res, `Failed to fetch multi-timeframe OHLCV data: ${error}`, 500);
    }
  }
}

// Export singleton instance for use in routes
export const ohlcvController = new OHLCVController();
