/**
 * Custom Pair Routes for Elysia
 * Allows creating synthetic trading pairs by dividing two ticker prices
 */

import { Elysia, t } from 'elysia';
import { ccxtService } from '../services/ccxtService';
import { cacheService } from '../services/cacheService';
import { successResponse } from '../utils/response';
import { SupportedExchange, Timeframe, OHLCV } from '@lazuli/shared';
import { createServiceLogger } from '../utils/logger';
import { validateExchange, validateInteger } from '../utils/validation';

// Create logger for custom pair routes
const log = createServiceLogger('customPair');
import {
  invalidExchange,
  invalidTimeframe,
  invalidMarketType,
  missingParameter,
  dataNotFound,
} from '../errors';

// Valid timeframes
const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

/**
 * Extract base currency from symbol
 * Handles both - and / separators
 */
function extractBaseCurrency(symbol: string): string {
  const parts = symbol.split(/[-/]/);
  return parts[0] || symbol;
}

/**
 * Fetch OHLCV data for a single symbol
 */
async function fetchOHLCVForSymbol(
  exchangeId: SupportedExchange,
  symbol: string,
  timeframe: Timeframe,
  marketType: 'spot' | 'perp',
  limit: number
): Promise<OHLCV[]> {
  const cacheKey = `ohlcv:${exchangeId}:${symbol}:${timeframe}:${marketType}:${limit}`;
  let candles = cacheService.get<OHLCV[]>(cacheKey);

  if (!candles) {
    candles = await ccxtService.fetchOHLCV(exchangeId, symbol, timeframe, marketType, limit);
    cacheService.set(cacheKey, candles, 60000);
  }

  return candles;
}

/**
 * Calculate custom pair OHLCV data by dividing two sets of candles
 */
function calculateCustomPair(candles1: OHLCV[], candles2: OHLCV[]): OHLCV[] {
  const candles2Map = new Map<number, OHLCV>();
  candles2.forEach((candle) => {
    candles2Map.set(candle.timestamp, candle);
  });

  const customPairCandles: OHLCV[] = [];

  for (const candle1 of candles1) {
    const candle2 = candles2Map.get(candle1.timestamp);

    if (!candle2) {
      continue;
    }

    // Validate both candles for zero or null values
    if (
      !candle1.open ||
      !candle1.high ||
      !candle1.low ||
      !candle1.close ||
      !candle2.open ||
      !candle2.high ||
      !candle2.low ||
      !candle2.close
    ) {
      continue;
    }

    const customCandle: OHLCV = {
      timestamp: candle1.timestamp,
      open: candle1.open / candle2.open,
      high: candle1.high / candle2.high,
      low: candle1.low / candle2.low,
      close: candle1.close / candle2.close,
      volume: candle1.volume,
    };

    customPairCandles.push(customCandle);
  }

  if (customPairCandles.length === 0) {
    log.warn(
      'No matching timestamps found between the two symbols. This may indicate data misalignment.'
    );
  }

  return customPairCandles;
}

/**
 * Custom pair routes plugin
 */
export const customPairRoutes = new Elysia({ prefix: '/custom-pair' })
  // GET /api/v1/custom-pair/:exchange/:symbol1/:symbol2 - Generate custom pair
  .get(
    '/:exchange/:symbol1/:symbol2',
    async ({ params, query }) => {
      const exchangeId = validateExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      const symbol1 = params.symbol1;
      const symbol2 = params.symbol2;

      if (!symbol1) {
        throw missingParameter('symbol1');
      }
      if (!symbol2) {
        throw missingParameter('symbol2');
      }

      // Validate timeframe parameter
      const timeframe = query.timeframe as Timeframe;
      if (!timeframe) {
        throw missingParameter('timeframe');
      }

      if (!validTimeframes.includes(timeframe)) {
        throw invalidTimeframe(timeframe, validTimeframes);
      }

      // Validate market type parameter
      const marketType = (query.type as 'spot' | 'perp') || 'spot';
      if (marketType !== 'spot' && marketType !== 'perp') {
        throw invalidMarketType(String(query.type));
      }

      const limit = validateInteger(query.limit, 100, 1, 1000);

      // Create cache key
      const cacheKey = `custom-pair:${exchangeId}:${symbol1}:${symbol2}:${timeframe}:${marketType}:${limit}`;
      let customPairCandles = cacheService.get<OHLCV[]>(cacheKey);

      if (!customPairCandles) {
        log.debug('Cache miss, fetching from exchange', { cacheKey });

        // Fetch OHLCV data for both symbols in parallel
        const [candles1, candles2] = await Promise.all([
          fetchOHLCVForSymbol(exchangeId, symbol1, timeframe, marketType, limit),
          fetchOHLCVForSymbol(exchangeId, symbol2, timeframe, marketType, limit),
        ]);

        if (!candles1 || candles1.length === 0) {
          throw dataNotFound(`No data available for ${symbol1}`);
        }

        if (!candles2 || candles2.length === 0) {
          throw dataNotFound(`No data available for ${symbol2}`);
        }

        // Calculate custom pair by dividing symbol1 by symbol2
        customPairCandles = calculateCustomPair(candles1, candles2);

        cacheService.set(cacheKey, customPairCandles, 60000);
      } else {
        log.debug('Cache hit', { cacheKey });
      }

      const base1 = extractBaseCurrency(symbol1);
      const base2 = extractBaseCurrency(symbol2);
      const customPairSymbol = `${base1}/${base2}`;

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

      return successResponse(response);
    },
    {
      params: t.Object({
        exchange: t.String(),
        symbol1: t.String(),
        symbol2: t.String(),
      }),
      query: t.Object({
        timeframe: t.Optional(t.String()),
        type: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  );
