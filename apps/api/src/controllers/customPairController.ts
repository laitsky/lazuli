import { Request, Response } from 'express';
import { ccxtService } from '../services/ccxtService';
import { cacheService } from '../services/cacheService';
import { requestCoalescingService } from '../services/requestCoalescingService';
import { successResponse, errorResponse } from '../utils/response';
import { SupportedExchange, Timeframe, OHLCV } from '@lazuli/shared';
import { validateExchange, validateInteger } from '../utils/validation';

/**
 * Controller for custom pair generation
 * Allows creating synthetic trading pairs by dividing two ticker prices
 * Example: BTC-USDT / AVAX-USDT = BTC/AVAX custom pair
 */
export class CustomPairController {
  /**
   * Extract base currency from symbol
   * Handles both - and / separators
   * @param symbol - Trading pair symbol (e.g., BTC-USDT or BTC/USDT)
   * @returns Base currency (e.g., BTC)
   */
  private extractBaseCurrency(symbol: string): string {
    const parts = symbol.split(/[-/]/);
    return parts[0] || symbol;
  }
  /**
   * Generate custom pair OHLCV data by dividing two ticker prices
   *
   * This endpoint fetches OHLCV data for two symbols and creates a custom pair
   * by dividing the first symbol's prices by the second symbol's prices.
   *
   * Example: GET /api/v1/custom-pair/binance/BTC-USDT/AVAX-USDT?timeframe=1h&limit=100
   * This would create BTC/AVAX pair data by dividing BTC-USDT by AVAX-USDT
   *
   * Query parameters:
   * - timeframe: Timeframe for candles (1m, 5m, 15m, 1h, 4h, 1d, 3d, 1w) - REQUIRED
   * - type: Market type ('spot' or 'perp', default: 'spot')
   * - limit: Number of candles to fetch (default: 100, max: 1000)
   *
   * @param req - Express request with exchange, symbol1, and symbol2 parameters
   * @param res - Express response object
   * @returns Response with custom pair OHLCV candles
   */
  async getCustomPair(req: Request, res: Response): Promise<Response> {
    try {
      // Validate and normalize exchange parameter
      const exchangeId = validateExchange(req.params.exchange);

      if (!exchangeId) {
        return errorResponse(res, `Exchange ${req.params.exchange} not supported`, 400);
      }

      // Extract and validate symbol parameters
      const symbol1 = req.params.symbol1; // Numerator (e.g., BTC-USDT)
      const symbol2 = req.params.symbol2; // Denominator (e.g., AVAX-USDT)

      if (!symbol1 || !symbol2) {
        return errorResponse(res, 'Both symbol1 and symbol2 parameters are required', 400);
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
      const cacheKey = `custom-pair:${exchangeId}:${symbol1}:${symbol2}:${timeframe}:${marketType}:${limit}`;
      let customPairCandles = cacheService.get<OHLCV[]>(cacheKey);

      // If not cached, fetch from exchange and calculate custom pair
      if (!customPairCandles) {
        console.log(`Cache miss for ${cacheKey}, fetching from exchange...`);

        // Fetch OHLCV data for both symbols in parallel
        const [candles1, candles2] = await Promise.all([
          this.fetchOHLCVForSymbol(exchangeId, symbol1, timeframe, marketType, limit),
          this.fetchOHLCVForSymbol(exchangeId, symbol2, timeframe, marketType, limit)
        ]);

        // Validate that we got data for both symbols
        if (!candles1 || candles1.length === 0) {
          return errorResponse(res, `No data available for ${symbol1}`, 404);
        }

        if (!candles2 || candles2.length === 0) {
          return errorResponse(res, `No data available for ${symbol2}`, 404);
        }

        // Calculate custom pair by dividing symbol1 by symbol2
        customPairCandles = this.calculateCustomPair(candles1, candles2);

        // Cache the results for 7 seconds (background jobs refresh proactively)
        cacheService.set(cacheKey, customPairCandles, 7000);
      } else {
        console.log(`Cache hit for ${cacheKey}`);
      }

      // Extract base currencies for display
      // For BTC-USDT / AVAX-USDT, result is BTC/AVAX
      const base1 = this.extractBaseCurrency(symbol1);
      const base2 = this.extractBaseCurrency(symbol2);
      const customPairSymbol = `${base1}/${base2}`;

      // Build response
      const response = {
        exchange: exchangeId,
        symbol1,
        symbol2,
        customPairSymbol,
        timeframe,
        marketType,
        candles: customPairCandles,
        count: customPairCandles.length,
      };

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getCustomPair:', error);
      // Don't expose raw error details to users for security
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return errorResponse(res, `Failed to generate custom pair data: ${errorMessage}`, 500);
    }
  }

  /**
   * Helper method to fetch OHLCV data for a single symbol
   * Uses the appropriate service based on exchange type
   *
   * @param exchangeId - Exchange identifier
   * @param symbol - Trading pair symbol
   * @param timeframe - Timeframe for candles
   * @param marketType - Market type (spot or perp)
   * @param limit - Number of candles to fetch
   * @returns Array of OHLCV candles
   */
  private async fetchOHLCVForSymbol(
    exchangeId: SupportedExchange,
    symbol: string,
    timeframe: Timeframe,
    marketType: 'spot' | 'perp',
    limit: number
  ): Promise<OHLCV[]> {
    // Check cache first
    const cacheKey = `ohlcv:${exchangeId}:${symbol}:${timeframe}:${marketType}:${limit}`;
    let candles = cacheService.get<OHLCV[]>(cacheKey);

    if (!candles) {
      // Fetch from appropriate exchange service with request coalescing
      candles = await requestCoalescingService.coalesce(
        cacheKey,
        async () => {
          switch (exchangeId) {
            case 'binance':
            case 'bybit':
            case 'okx':
              return await ccxtService.fetchOHLCV(
                exchangeId,
                symbol,
                timeframe,
                marketType,
                limit
              );
            default:
              throw new Error(`Exchange ${exchangeId} not supported`);
          }
        }
      );

      // Cache the results for 7 seconds (background jobs refresh proactively)
      cacheService.set(cacheKey, candles, 7000);
    }

    return candles;
  }

  /**
   * Calculate custom pair OHLCV data by dividing two sets of candles
   *
   * For each matching timestamp:
   * - open = candles1.open / candles2.open
   * - high = candles1.high / candles2.high
   * - low = candles1.low / candles2.low
   * - close = candles1.close / candles2.close
   * - volume = candles1.volume (keep numerator's volume)
   *
   * @param candles1 - OHLCV data for numerator symbol
   * @param candles2 - OHLCV data for denominator symbol
   * @returns Array of custom pair OHLCV candles
   */
  private calculateCustomPair(candles1: OHLCV[], candles2: OHLCV[]): OHLCV[] {
    // Create a map of candles2 by timestamp for efficient lookup
    const candles2Map = new Map<number, OHLCV>();
    candles2.forEach(candle => {
      candles2Map.set(candle.timestamp, candle);
    });

    // Calculate custom pair candles only for matching timestamps
    const customPairCandles: OHLCV[] = [];

    for (const candle1 of candles1) {
      const candle2 = candles2Map.get(candle1.timestamp);

      // Skip if no matching timestamp found
      if (!candle2) {
        continue;
      }

      // Validate both candles for zero or null values (division by zero protection)
      if (!candle1.open || !candle1.high || !candle1.low || !candle1.close ||
          !candle2.open || !candle2.high || !candle2.low || !candle2.close) {
        continue;
      }

      // Calculate custom pair prices by division
      const customCandle: OHLCV = {
        timestamp: candle1.timestamp,
        open: candle1.open / candle2.open,
        high: candle1.high / candle2.high,
        low: candle1.low / candle2.low,
        close: candle1.close / candle2.close,
        volume: candle1.volume, // Keep numerator's volume
      };

      customPairCandles.push(customCandle);
    }

    // Log warning if no matching timestamps were found
    if (customPairCandles.length === 0) {
      console.warn('No matching timestamps found between the two symbols. This may indicate data misalignment.');
    }

    return customPairCandles;
  }
}

// Export singleton instance for use in routes
export const customPairController = new CustomPairController();
