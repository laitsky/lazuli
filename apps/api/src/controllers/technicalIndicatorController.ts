import { Request, Response } from 'express';
import { ccxtService } from '../services/ccxtService';
import { cacheService } from '../services/cacheService';
import {
  calculateIndicators,
  TechnicalIndicatorResponse,
  DEFAULT_INDICATOR_CONFIG,
  parseIndicatorPeriods,
} from '../services/technicalIndicatorService';
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
 * Controller for Technical Indicators endpoint
 *
 * Provides SMA, EMA, and RSI calculations for any symbol on supported exchanges.
 * Indicators are calculated server-side for consistency and to reduce client computation.
 *
 * Supported indicators:
 * - SMA (Simple Moving Average): Smooths price data, common periods: 20, 50, 200
 * - EMA (Exponential Moving Average): More responsive to recent prices, common: 9, 12, 21, 26
 * - RSI (Relative Strength Index): Momentum oscillator, typical period: 14
 */
export class TechnicalIndicatorController {
  /**
   * Get technical indicators for a specific symbol
   *
   * Calculates multiple technical indicators (SMA, EMA, RSI) for the given symbol
   * and timeframe. Results are aligned with OHLCV data timestamps.
   *
   * Query parameters:
   * - timeframe: Timeframe for candles (1m, 5m, 15m, 1h, 4h, 1d, 3d, 1w) - REQUIRED
   * - type: Market type ('spot' or 'perp', default: 'spot')
   * - limit: Number of candles to fetch (default: 300, max: 1000)
   * - sma: Comma-separated SMA periods to calculate (default: 20,50,200)
   * - ema: Comma-separated EMA periods to calculate (default: 9,12,21,26)
   * - rsi: Comma-separated RSI periods to calculate (default: 14)
   *
   * @param req - Express request with exchange and symbol parameters
   * @param res - Express response object
   * @returns Response with technical indicator data
   *
   * @example
   * GET /api/v1/indicators/binance/BTC-USDT?timeframe=1h&sma=20,50,200&ema=12,26&rsi=14
   */
  async getIndicators(req: Request, res: Response): Promise<Response> {
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

      // Validate timeframe parameter (required)
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

      // Validate limit parameter
      // Exchange-specific max limits
      const exchangeLimits: Record<string, number> = {
        binance: 1000,
        bybit: 1000,
        okx: 300,
        hyperliquid: 1000,
        upbit: 200,
      };
      const maxLimit = exchangeLimits[exchangeId] || 1000;
      const limit = validateInteger(req.query.limit, 300, 50, maxLimit);

      // Parse indicator periods from query parameters
      const smaPeriods = parseIndicatorPeriods(
        req.query.sma as string,
        DEFAULT_INDICATOR_CONFIG.sma!
      );
      const emaPeriods = parseIndicatorPeriods(
        req.query.ema as string,
        DEFAULT_INDICATOR_CONFIG.ema!
      );
      const rsiPeriods = parseIndicatorPeriods(
        req.query.rsi as string,
        DEFAULT_INDICATOR_CONFIG.rsi!
      );

      // Create cache key including all parameters
      const cacheKey = `indicators:${exchangeId}:${symbol}:${timeframe}:${marketType}:${limit}:sma${smaPeriods.join('-')}:ema${emaPeriods.join('-')}:rsi${rsiPeriods.join('-')}`;

      // Check cache first
      const cachedResult = cacheService.get<TechnicalIndicatorResponse>(cacheKey);

      if (cachedResult) {
        console.log(`Cache hit for ${cacheKey}`);
        return successResponse(res, cachedResult);
      }

      console.log(`Cache miss for ${cacheKey}, calculating indicators...`);

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

      // Calculate all requested indicators
      const indicatorData = calculateIndicators(ohlcvData, {
        sma: smaPeriods,
        ema: emaPeriods,
        rsi: rsiPeriods,
      });

      // Build response
      const response: TechnicalIndicatorResponse = {
        exchange: exchangeId,
        symbol,
        timeframe,
        marketType,
        indicators: {
          sma: smaPeriods,
          ema: emaPeriods,
          rsi: rsiPeriods,
        },
        data: indicatorData,
        candleCount: ohlcvData.length,
      };

      // Cache for 1 minute (indicator data changes with new candles)
      cacheService.set(cacheKey, response, 60000);

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getIndicators:', error);
      return handleError(res, error, 'Failed to calculate technical indicators');
    }
  }
}

// Export singleton instance for use in routes
export const technicalIndicatorController = new TechnicalIndicatorController();
