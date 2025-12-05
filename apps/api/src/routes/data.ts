/**
 * Data Routes for Elysia
 * OPTIONAL database storage and historical data endpoints
 *
 * NOTE: These endpoints are for advanced features only:
 * - Historical data analysis
 * - Price alerts and notifications
 * - Arbitrage opportunity tracking
 *
 * For real-time trading data, use /tickers and /markets endpoints instead.
 */

import { Elysia, t } from 'elysia';
import { databaseService } from '../services/databaseService';
import { ccxtService } from '../services/ccxtService';
import { successResponse } from '../utils/response';
import { invalidExchange, invalidParameter, dataNotFound } from '../errors';
import { validateExchange } from '../utils/validation';

/**
 * Data routes plugin
 */
export const dataRoutes = new Elysia({ prefix: '/data' })
  // POST /api/v1/data/store/:exchange - Store live ticker data
  .post(
    '/store/:exchange',
    async ({ params }) => {
      const exchangeId = validateExchange(params.exchange);
      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      // Fetch live ticker data
      const tickers = await ccxtService.getAllTickers(exchangeId);

      // Store in database
      const storedCount = await databaseService.storeTickers(tickers);

      return successResponse({
        exchange: exchangeId,
        tickersStored: storedCount,
        totalTickers: tickers.length,
        timestamp: Date.now(),
      });
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
    }
  )
  // GET /api/v1/data/history/:symbol - Get historical ticker data
  .get(
    '/history/:symbol',
    async ({ params, query }) => {
      const { symbol } = params;
      const { exchange, limit } = query;

      // Parse limit parameter
      const limitNum = limit ? parseInt(limit as string, 10) : 100;
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
        throw invalidParameter('limit', 'Limit must be between 1 and 1000');
      }

      // Fetch historical data
      const historicalData = await databaseService.getHistoricalTickers(
        symbol,
        exchange as string,
        limitNum
      );

      return successResponse({
        symbol,
        exchange: exchange || 'all',
        count: historicalData.length,
        limit: limitNum,
        data: historicalData,
      });
    },
    {
      params: t.Object({
        symbol: t.String(),
      }),
      query: t.Object({
        exchange: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )
  // GET /api/v1/data/latest/:exchange/:symbol - Get latest stored ticker
  .get(
    '/latest/:exchange/:symbol',
    async ({ params }) => {
      const { symbol, exchange } = params;

      const latestTicker = await databaseService.getLatestTicker(symbol, exchange);

      if (!latestTicker) {
        throw dataNotFound(`No stored data found for ${symbol} on ${exchange}`);
      }

      return successResponse(latestTicker);
    },
    {
      params: t.Object({
        exchange: t.String(),
        symbol: t.String(),
      }),
    }
  )
  // POST /api/v1/data/markets/:exchange - Store market data
  .post(
    '/markets/:exchange',
    async ({ params }) => {
      const exchangeId = validateExchange(params.exchange);
      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      // Fetch market data
      const markets = await ccxtService.getMarkets(exchangeId);

      // Store in database
      const storedCount = await databaseService.storeMarkets(markets);

      return successResponse({
        exchange: exchangeId,
        marketsStored: storedCount,
        totalMarkets: markets.length,
        timestamp: Date.now(),
      });
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
    }
  )
  // DELETE /api/v1/data/cleanup - Clean up old ticker data
  .delete(
    '/cleanup',
    async ({ query }) => {
      const { days } = query;

      // Parse days parameter
      const daysToKeep = days ? parseInt(days as string, 10) : 30;
      if (isNaN(daysToKeep) || daysToKeep < 1 || daysToKeep > 365) {
        throw invalidParameter('days', 'Days must be between 1 and 365');
      }

      const deletedCount = await databaseService.cleanupOldTickers(daysToKeep);

      return successResponse({
        deletedRecords: deletedCount,
        daysKept: daysToKeep,
        timestamp: Date.now(),
      });
    },
    {
      query: t.Object({
        days: t.Optional(t.String()),
      }),
    }
  );
