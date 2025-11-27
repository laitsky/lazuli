import { Request, Response } from 'express';
import { databaseService } from '../services/databaseService';
import { ccxtService } from '../services/ccxtService';
import { successResponse, handleError } from '../utils/response';
import { invalidExchange, invalidParameter, dataNotFound } from '../errors';
import { validateExchange } from '../utils/validation';

/**
 * Controller for OPTIONAL database storage and historical data endpoints
 *
 * NOTE: These endpoints are for advanced features only:
 * - Historical data analysis
 * - Price alerts and notifications
 * - Arbitrage opportunity tracking
 *
 * For real-time trading data, use /tickers and /markets endpoints instead.
 * Database setup is required only if you use these /data/* endpoints.
 */
export class DataController {
  /**
   * Store current ticker data for an exchange in the database
   * @param req - Express request with exchange parameter
   * @param res - Express response object
   * @returns Response with storage result
   */
  async storeLiveTickers(req: Request, res: Response): Promise<Response> {
    try {
      // Extract and validate exchange parameter
      const exchangeId = validateExchange(req.params.exchange);
      if (!exchangeId) {
        throw invalidExchange(req.params.exchange);
      }

      // Fetch live ticker data
      const tickers = await ccxtService.getAllTickers(exchangeId);

      // Store in database
      const storedCount = await databaseService.storeTickers(tickers);

      return successResponse(res, {
        exchange: exchangeId,
        tickersStored: storedCount,
        totalTickers: tickers.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error in storeLiveTickers:', error);
      return handleError(res, error, 'Failed to store ticker data');
    }
  }

  /**
   * Get historical ticker data for a symbol
   * @param req - Express request with symbol parameter and optional query params
   * @param res - Express response object
   * @returns Response with historical ticker data
   */
  async getHistoricalTickers(req: Request, res: Response): Promise<Response> {
    try {
      const { symbol } = req.params;
      const { exchange, limit } = req.query;

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

      return successResponse(res, {
        symbol,
        exchange: exchange || 'all',
        count: historicalData.length,
        limit: limitNum,
        data: historicalData,
      });
    } catch (error) {
      console.error('Error in getHistoricalTickers:', error);
      return handleError(res, error, 'Failed to fetch historical data');
    }
  }

  /**
   * Get latest stored ticker for a symbol and exchange
   * @param req - Express request with symbol and exchange parameters
   * @param res - Express response object
   * @returns Response with latest ticker data
   */
  async getLatestStoredTicker(req: Request, res: Response): Promise<Response> {
    try {
      const { symbol, exchange } = req.params;

      const latestTicker = await databaseService.getLatestTicker(symbol, exchange);

      if (!latestTicker) {
        throw dataNotFound(`No stored data found for ${symbol} on ${exchange}`);
      }

      return successResponse(res, latestTicker);
    } catch (error) {
      console.error('Error in getLatestStoredTicker:', error);
      return handleError(res, error, 'Failed to fetch latest ticker');
    }
  }

  /**
   * Store current market data for an exchange in the database
   * @param req - Express request with exchange parameter
   * @param res - Express response object
   * @returns Response with storage result
   */
  async storeMarkets(req: Request, res: Response): Promise<Response> {
    try {
      // Extract and validate exchange parameter
      const exchangeId = validateExchange(req.params.exchange);
      if (!exchangeId) {
        throw invalidExchange(req.params.exchange);
      }

      // Fetch market data
      const markets = await ccxtService.getMarkets(exchangeId);

      // Store in database
      const storedCount = await databaseService.storeMarkets(markets);

      return successResponse(res, {
        exchange: exchangeId,
        marketsStored: storedCount,
        totalMarkets: markets.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error in storeMarkets:', error);
      return handleError(res, error, 'Failed to store market data');
    }
  }

  /**
   * Clean up old ticker data from database
   * @param req - Express request with optional days query parameter
   * @param res - Express response object
   * @returns Response with cleanup result
   */
  async cleanupOldData(req: Request, res: Response): Promise<Response> {
    try {
      const { days } = req.query;

      // Parse days parameter
      const daysToKeep = days ? parseInt(days as string, 10) : 30;
      if (isNaN(daysToKeep) || daysToKeep < 1 || daysToKeep > 365) {
        throw invalidParameter('days', 'Days must be between 1 and 365');
      }

      const deletedCount = await databaseService.cleanupOldTickers(daysToKeep);

      return successResponse(res, {
        deletedRecords: deletedCount,
        daysKept: daysToKeep,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error in cleanupOldData:', error);
      return handleError(res, error, 'Failed to cleanup old data');
    }
  }
}

// Export singleton instance for use in routes
export const dataController = new DataController();
