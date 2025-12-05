/**
 * Technical Indicator Routes for Elysia
 * Provides SMA, EMA, and RSI calculations for any symbol on supported exchanges
 */

import { Elysia, t } from 'elysia';
import { ccxtService } from '../services/ccxtService';
import { cacheService } from '../services/cacheService';
import {
  calculateIndicators,
  TechnicalIndicatorResponse,
  DEFAULT_INDICATOR_CONFIG,
  parseIndicatorPeriods,
} from '../services/technicalIndicatorService';
import { successResponse } from '../utils/response';
import { Timeframe } from '@lazuli/shared';
import { createServiceLogger } from '../utils/logger';
import { validateExchange, validateInteger } from '../utils/validation';

// Create logger for indicator routes
const log = createServiceLogger('indicators');
import {
  invalidExchange,
  invalidTimeframe,
  invalidMarketType,
  missingParameter,
  dataNotFound,
} from '../errors';

// Valid timeframes
const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

// Exchange-specific max limits
const exchangeLimits: Record<string, number> = {
  binance: 1000,
  bybit: 1000,
  okx: 300,
  hyperliquid: 1000,
  upbit: 200,
};

/**
 * Technical indicator routes plugin
 */
export const indicatorRoutes = new Elysia({ prefix: '/indicators' })
  // GET /api/v1/indicators/:exchange/:symbol - Get technical indicators
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

      // Validate timeframe parameter (required)
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

      // Validate limit parameter
      const maxLimit = exchangeLimits[exchangeId] || 1000;
      const limit = validateInteger(query.limit, 300, 50, maxLimit);

      // Parse indicator periods from query parameters
      const smaPeriods = parseIndicatorPeriods(query.sma as string, DEFAULT_INDICATOR_CONFIG.sma!);
      const emaPeriods = parseIndicatorPeriods(query.ema as string, DEFAULT_INDICATOR_CONFIG.ema!);
      const rsiPeriods = parseIndicatorPeriods(query.rsi as string, DEFAULT_INDICATOR_CONFIG.rsi!);

      // Create cache key including all parameters
      const cacheKey = `indicators:${exchangeId}:${params.symbol}:${timeframe}:${marketType}:${limit}:sma${smaPeriods.join('-')}:ema${emaPeriods.join('-')}:rsi${rsiPeriods.join('-')}`;

      // Check cache first
      const cachedResult = cacheService.get<TechnicalIndicatorResponse>(cacheKey);

      if (cachedResult) {
        log.debug('Cache hit', { cacheKey });
        return successResponse(cachedResult);
      }

      log.debug('Cache miss, calculating indicators', { cacheKey });

      // Fetch OHLCV data from exchange
      const ohlcvData = await ccxtService.fetchOHLCV(
        exchangeId,
        params.symbol,
        timeframe,
        marketType,
        limit
      );

      if (!ohlcvData || ohlcvData.length === 0) {
        throw dataNotFound(`No OHLCV data available for ${params.symbol}`);
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
        symbol: params.symbol,
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

      // Cache for 1 minute
      cacheService.set(cacheKey, response, 60000);

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
        sma: t.Optional(t.String()),
        ema: t.Optional(t.String()),
        rsi: t.Optional(t.String()),
      }),
    }
  );
