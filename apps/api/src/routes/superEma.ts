/**
 * SuperEMA Routes for Elysia
 * Calculates hundreds of EMA lines (1-400) for comprehensive technical analysis
 */

import { Elysia, t } from 'elysia';
import { ccxtService } from '../services/ccxtService';
import { cacheService } from '../services/cacheService';
import { calculateSuperEMA, SuperEMAResponse } from '../services/emaService';
import { successResponse } from '../utils/response';
import { Timeframe } from '@lazuli/shared';
import { createServiceLogger } from '../utils/logger';
import { validateExchange, validateInteger } from '../utils/validation';

// Create logger for SuperEMA routes
const log = createServiceLogger('superEma');
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
 * SuperEMA routes plugin
 */
export const superEmaRoutes = new Elysia({ prefix: '/superema' })
  // GET /api/v1/superema/:exchange/:symbol - Get SuperEMA data
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
      const marketType = (query.type as 'spot' | 'perp') || 'spot';
      if (marketType !== 'spot' && marketType !== 'perp') {
        throw invalidMarketType(String(query.type));
      }

      // Validate limit parameter
      const maxLimit = exchangeLimits[exchangeId] || 1000;
      const limit = validateInteger(query.limit, maxLimit, 100, maxLimit);

      // Validate maxPeriod parameter
      const maxPeriod = validateInteger(query.maxPeriod, 400, 1, 400);

      // Create cache key
      const cacheKey = `superema:${exchangeId}:${params.symbol}:${timeframe}:${marketType}:${limit}:${maxPeriod}`;
      const cachedResult = await cacheService.getAsync<SuperEMAResponse>(cacheKey);

      if (cachedResult) {
        log.debug('Cache hit', { cacheKey });
        return successResponse(cachedResult);
      }

      log.debug('Cache miss, calculating SuperEMA', { cacheKey });

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

      // Calculate SuperEMA (all periods from 1 to maxPeriod)
      const emaData = calculateSuperEMA(ohlcvData, maxPeriod);

      // Generate array of periods for reference
      const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);

      // Build response
      const response: SuperEMAResponse = {
        exchange: exchangeId,
        symbol: params.symbol,
        timeframe,
        marketType,
        periods,
        data: emaData,
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
        maxPeriod: t.Optional(t.String()),
      }),
    }
  );
