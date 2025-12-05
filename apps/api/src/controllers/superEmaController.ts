import { Request, Response } from 'express';
import { ccxtService } from '../services/ccxtService';
import { cacheService } from '../services/cacheService';
import { calculateSuperEMA, SuperEMAResponse } from '../services/emaService';
import { successResponse, handleError } from '../utils/response';
import { Timeframe } from '@lazuli/shared';
import { validateExchange, validateInteger } from '../utils/validation';
import {
  invalidExchange,
  invalidTimeframe,
  invalidMarketType,
  missingParameter,
  dataNotFound,
} from '../errors';

/**
 * Controller for SuperEMA endpoints
 * Calculates hundreds of EMA lines (1-400) for comprehensive technical analysis
 */
export class SuperEmaController {
  /**
   * Get SuperEMA data for a specific symbol
   * Calculates EMAs from period 1 to 400 for the given symbol and timeframe
   *
   * Query parameters:
   * - timeframe: Timeframe for candles (1m, 5m, 15m, 1h, 4h, 1d, 3d, 1w) - REQUIRED
   * - type: Market type ('spot' or 'perp', default: 'spot')
   * - limit: Number of candles to fetch (default: 500, max: 1000)
   * - maxPeriod: Maximum EMA period to calculate (default: 400, max: 400)
   *
   * @param req - Express request with exchange and symbol parameters
   * @param res - Express response object
   * @returns Response with SuperEMA data
   */
  async getSuperEMA(req: Request, res: Response): Promise<Response> {
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

      // Validate timeframe parameter
      const timeframe = req.query.timeframe as Timeframe;
      if (!timeframe) {
        throw missingParameter('timeframe');
      }

      const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];
      if (!validTimeframes.includes(timeframe)) {
        throw invalidTimeframe(timeframe, validTimeframes);
      }

      // Validate market type parameter
      const marketType = (req.query.type as 'spot' | 'perp') || 'spot';
      if (marketType !== 'spot' && marketType !== 'perp') {
        throw invalidMarketType(String(req.query.type));
      }

      // Validate limit parameter (need more candles for accurate EMA calculation)
      // Exchange-specific max limits: Binance=1000, Bybit=1000, OKX=300
      // Default to max for the exchange
      const exchangeLimits: Record<string, number> = {
        binance: 1000,
        bybit: 1000,
        okx: 300,
      };
      const maxLimit = exchangeLimits[exchangeId] || 1000;
      const limit = validateInteger(req.query.limit, maxLimit, 100, maxLimit);

      // Validate maxPeriod parameter
      const maxPeriod = validateInteger(req.query.maxPeriod, 400, 1, 400);

      // Create cache key
      const cacheKey = `superema:${exchangeId}:${symbol}:${timeframe}:${marketType}:${limit}:${maxPeriod}`;
      const cachedResult = cacheService.get<SuperEMAResponse>(cacheKey);

      if (cachedResult) {
        console.log(`Cache hit for ${cacheKey}`);
        return successResponse(res, cachedResult);
      }

      console.log(`Cache miss for ${cacheKey}, calculating SuperEMA...`);

      // Fetch OHLCV data from exchange
      const ohlcvData = await ccxtService.fetchOHLCV(
        exchangeId,
        symbol,
        timeframe,
        marketType,
        limit
      );

      if (!ohlcvData || ohlcvData.length === 0) {
        throw dataNotFound(`No OHLCV data available for ${symbol}`);
      }

      // Calculate SuperEMA (all periods from 1 to maxPeriod)
      const emaData = calculateSuperEMA(ohlcvData, maxPeriod);

      // Generate array of periods for reference
      const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);

      // Build response
      const response: SuperEMAResponse = {
        exchange: exchangeId,
        symbol,
        timeframe,
        marketType,
        periods,
        data: emaData,
        candleCount: ohlcvData.length,
      };

      // Cache for 1 minute (EMA data changes with new candles)
      cacheService.set(cacheKey, response, 60000);

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getSuperEMA:', error);
      return handleError(res, error, 'Failed to calculate SuperEMA');
    }
  }
}

// Export singleton instance for use in routes
export const superEmaController = new SuperEmaController();
