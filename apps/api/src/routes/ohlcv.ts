/**
 * OHLCV Routes for Elysia
 * Routes requests for candlestick/OHLCV data from exchanges
 */

import { Elysia, t } from 'elysia';
import { ccxtService } from '../services/ccxtService';
import { cacheService } from '../services/cacheService';
import { successResponse } from '../utils/response';
import { Timeframe, OHLCVResponse } from '@lazuli/shared';
import { createServiceLogger } from '../utils/logger';
import { validateExchange, validateInteger } from '../utils/validation';
import {
  invalidExchange,
  invalidTimeframe,
  invalidMarketType,
  missingParameter,
  invalidParameter,
  internalError,
} from '../errors';

// Create logger for OHLCV routes
const log = createServiceLogger('ohlcv');

// Valid timeframes
const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

/**
 * OHLCV routes plugin
 */
export const ohlcvRoutes = new Elysia({ prefix: '/ohlcv' })
  // GET /api/v1/ohlcv/timeframes/:exchange - Get supported timeframes
  .get(
    '/timeframes/:exchange',
    async ({ params, query }) => {
      const exchangeId = validateExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
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

      const supportedTimeframes = ccxtService.getSupportedTimeframes(exchangeId, marketType);

      // Filter to only include our standard timeframes
      const standardTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];
      const filteredTimeframes = standardTimeframes.filter((tf) =>
        supportedTimeframes.includes(tf)
      );

      const response = {
        exchange: exchangeId,
        marketType,
        supportedTimeframes: filteredTimeframes,
        allExchangeTimeframes: supportedTimeframes,
      };

      return successResponse(response);
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
      query: t.Object({
        type: t.Optional(t.String()),
      }),
    }
  )
  // GET /api/v1/ohlcv/multi/:exchange/:symbol - Get OHLCV for multiple timeframes
  .get(
    '/multi/:exchange/:symbol',
    async ({ params, query }) => {
      const exchangeId = validateExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      if (!params.symbol) {
        throw missingParameter('symbol');
      }

      // Validate timeframes parameter
      const timeframesParam = query.timeframes as string;
      if (!timeframesParam) {
        throw missingParameter('timeframes');
      }

      const timeframes = timeframesParam.split(',').map((tf) => tf.trim()) as Timeframe[];

      // Validate each timeframe
      for (const tf of timeframes) {
        if (!validTimeframes.includes(tf)) {
          throw invalidTimeframe(tf, validTimeframes);
        }
      }

      // Limit to max 8 timeframes
      if (timeframes.length > 8) {
        throw invalidParameter('timeframes', 'Maximum 8 timeframes allowed per request');
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

      const limit = validateInteger(query.limit, 100, 1, 1000);

      // Fetch OHLCV data for all timeframes in parallel
      const promises = timeframes.map(async (timeframe) => {
        try {
          const cacheKey = `ohlcv:${exchangeId}:${params.symbol}:${timeframe}:${marketType}:${limit}`;
          let candles = cacheService.get<any[]>(cacheKey);

          if (!candles) {
            log.debug('Cache miss, fetching from exchange', { cacheKey });
            candles = await ccxtService.fetchOHLCV(
              exchangeId,
              params.symbol,
              timeframe,
              marketType,
              limit
            );
            cacheService.set(cacheKey, candles, 60000);
          } else {
            log.debug('Cache hit', { cacheKey });
          }

          return {
            timeframe,
            candles,
            count: candles.length,
            success: true,
            error: null,
          };
        } catch (error) {
          log.error('Error fetching OHLCV data', error, {
            timeframe,
            symbol: params.symbol,
            exchange: exchangeId,
          });
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

      const timeframesData = results.map((result) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            timeframe: 'unknown',
            candles: [],
            count: 0,
            success: false,
            error: result.reason,
          };
        }
      });

      const successCount = timeframesData.filter((tf) => tf.success).length;
      const failedCount = timeframesData.filter((tf) => !tf.success).length;

      const response = {
        exchange: exchangeId,
        symbol: params.symbol,
        marketType,
        timeframes: timeframesData,
        summary: {
          total: timeframesData.length,
          successful: successCount,
          failed: failedCount,
        },
      };

      if (successCount === 0) {
        throw internalError('Failed to fetch data for all timeframes');
      }

      return successResponse(response);
    },
    {
      params: t.Object({
        exchange: t.String(),
        symbol: t.String(),
      }),
      query: t.Object({
        timeframes: t.Optional(t.String()),
        type: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )
  // GET /api/v1/ohlcv/:exchange/:symbol - Get OHLCV data for a symbol
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

      // Validate timeframe parameter
      const timeframe = query.timeframe as Timeframe;
      if (!timeframe) {
        throw missingParameter('timeframe');
      }

      if (!validTimeframes.includes(timeframe)) {
        throw invalidTimeframe(timeframe, validTimeframes);
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

      const limit = validateInteger(query.limit, 100, 1, 1000);

      // Create cache key
      const cacheKey = `ohlcv:${exchangeId}:${params.symbol}:${timeframe}:${marketType}:${limit}`;
      let candles = cacheService.get<any[]>(cacheKey);

      if (!candles) {
        log.debug('Cache miss, fetching from exchange', { cacheKey });
        candles = await ccxtService.fetchOHLCV(
          exchangeId,
          params.symbol,
          timeframe,
          marketType,
          limit
        );
        cacheService.set(cacheKey, candles, 60000);
      } else {
        log.debug('Cache hit', { cacheKey });
      }

      const response: OHLCVResponse = {
        exchange: exchangeId,
        symbol: params.symbol,
        timeframe,
        candles,
        count: candles.length,
      };

      return successResponse(response);
    },
    {
      params: t.Object({
        exchange: t.String(),
        symbol: t.String(),
      }),
      query: t.Object({
        timeframe: t.Optional(t.String()),
        type: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  );
