import { Request, Response } from 'express';
import { ccxtService } from '../services/ccxtService';
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
   * Get supported timeframes for an exchange
   *
   * Query parameters:
   * - type: Market type ('spot' or 'perp', default: 'spot')
   *
   * @param req - Express request with exchange parameter
   * @param res - Express response object
   * @returns Response with list of supported timeframes
   */
  async getSupportedTimeframes(req: Request, res: Response): Promise<Response> {
    try {
      // Validate and normalize exchange parameter
      const exchangeId = validateExchange(req.params.exchange);

      if (!exchangeId) {
        return errorResponse(res, `Exchange ${req.params.exchange} not supported`, 400);
      }

      // Validate market type parameter
      const marketType = (req.query.type as 'spot' | 'perp') || 'spot';
      if (marketType !== 'spot' && marketType !== 'perp') {
        return errorResponse(res, 'Market type must be "spot" or "perp"', 400);
      }

      let supportedTimeframes: string[] = [];

      // Get supported timeframes based on exchange
      switch (exchangeId) {
        case 'binance':
        case 'bybit':
        case 'okx':
          supportedTimeframes = ccxtService.getSupportedTimeframes(exchangeId, marketType);
          break;
      }

      // Filter to only include our standard timeframes
      const standardTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];
      const filteredTimeframes = standardTimeframes.filter(tf =>
        supportedTimeframes.includes(tf)
      );

      const response = {
        exchange: exchangeId,
        marketType,
        supportedTimeframes: filteredTimeframes,
        allExchangeTimeframes: supportedTimeframes,
      };

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getSupportedTimeframes:', error);
      return errorResponse(res, `Failed to fetch supported timeframes: ${error}`, 500);
    }
  }

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

      // Fetch OHLCV data for all timeframes in parallel
      // Use Promise.allSettled to handle partial failures gracefully
      const promises = timeframes.map(async (timeframe) => {
        try {
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
            success: true,
            error: null,
          };
        } catch (error) {
          // Log the error but don't fail the entire request
          console.error(`Error fetching ${timeframe} for ${symbol} on ${exchangeId}:`, error);

          return {
            timeframe,
            candles: [],
            count: 0,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      });

      const results = await Promise.allSettled(promises);

      // Extract results and separate successful vs failed timeframes
      const timeframesData = results.map(result => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          // This shouldn't happen since we catch errors inside, but handle it anyway
          return {
            timeframe: 'unknown',
            candles: [],
            count: 0,
            success: false,
            error: result.reason,
          };
        }
      });

      // Count successful vs failed fetches
      const successCount = timeframesData.filter(tf => tf.success).length;
      const failedCount = timeframesData.filter(tf => !tf.success).length;

      // Build response with data for each timeframe
      const response = {
        exchange: exchangeId,
        symbol,
        marketType,
        timeframes: timeframesData,
        summary: {
          total: timeframesData.length,
          successful: successCount,
          failed: failedCount,
        },
      };

      // If all timeframes failed, return an error
      if (successCount === 0) {
        return errorResponse(res, 'Failed to fetch data for all timeframes', 500);
      }

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getMultiTimeframeOHLCV:', error);
      return errorResponse(res, `Failed to fetch multi-timeframe OHLCV data: ${error}`, 500);
    }
  }
}

// Export singleton instance for use in routes
export const ohlcvController = new OHLCVController();
