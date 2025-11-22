import { Request, Response } from 'express';
import { databaseService } from '../services/databaseService';
import { ccxtService } from '../services/ccxtService';
import { successResponse, errorResponse } from '../utils/response';
import { SupportedExchange } from '../types';

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
      // Extract exchange parameter
      const { exchange } = req.params;
      const exchangeId = exchange.toLowerCase() as SupportedExchange;

      // Fetch live ticker data
      let tickers;
      switch (exchangeId) {
        case 'binance':
        case 'bybit':
        case 'okx':
          tickers = await ccxtService.getAllTickers(exchangeId);
          break;
        default:
          return errorResponse(res, `Exchange ${exchange} not supported`, 400);
      }

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
      return errorResponse(res, `Failed to store ticker data: ${error}`, 500);
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
        return errorResponse(res, 'Limit must be between 1 and 1000', 400);
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
      return errorResponse(res, `Failed to fetch historical data: ${error}`, 500);
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
        return errorResponse(res, `No stored data found for ${symbol} on ${exchange}`, 404);
      }

      return successResponse(res, latestTicker);
    } catch (error) {
      console.error('Error in getLatestStoredTicker:', error);
      return errorResponse(res, `Failed to fetch latest ticker: ${error}`, 500);
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
      // Extract exchange parameter
      const { exchange } = req.params;
      const exchangeId = exchange.toLowerCase() as SupportedExchange;

      // Fetch market data
      let markets;
      switch (exchangeId) {
        case 'binance':
        case 'bybit':
        case 'okx':
          markets = await ccxtService.getMarkets(exchangeId);
          break;
        default:
          return errorResponse(res, `Exchange ${exchange} not supported`, 400);
      }

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
      return errorResponse(res, `Failed to store market data: ${error}`, 500);
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
        return errorResponse(res, 'Days must be between 1 and 365', 400);
      }

      const deletedCount = await databaseService.cleanupOldTickers(daysToKeep);

      return successResponse(res, {
        deletedRecords: deletedCount,
        daysKept: daysToKeep,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error in cleanupOldData:', error);
      return errorResponse(res, `Failed to cleanup old data: ${error}`, 500);
    }
  }
}

// Export singleton instance for use in routes
export const dataController = new DataController();
