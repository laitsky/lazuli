import { Request, Response } from 'express';
import { backgroundJobService, OHLCVTarget, CustomPairTarget } from '../services/backgroundJobService';
import { requestCoalescingService } from '../services/requestCoalescingService';
import { rateLimitService } from '../services/rateLimitService';
import { successResponse, errorResponse } from '../utils/response';
import { SupportedExchange, Timeframe } from '@lazuli/shared';

/**
 * Controller for background job management
 * Provides endpoints to monitor and control background refresh jobs
 */
export class JobsController {
  /**
   * Get background job statistics and status
   *
   * Returns:
   * - Current job statistics (runs, success/failure counts)
   * - Job configuration
   * - Last run timestamps
   *
   * @param req - Express request
   * @param res - Express response object
   * @returns Response with job statistics
   */
  async getJobsStatus(_req: Request, res: Response): Promise<Response> {
    try {
      const stats = backgroundJobService.getStats();
      const config = backgroundJobService.getConfig();
      const coalescingStats = requestCoalescingService.getStats();
      const rateLimitStats = rateLimitService.getAllStats();

      const response = {
        stats,
        config: {
          ticker: {
            enabled: config.enableTickerRefresh,
            interval: config.tickerRefreshInterval,
            exchanges: config.exchanges,
          },
          ohlcv: {
            enabled: config.enableOhlcvRefresh,
            interval: config.ohlcvRefreshInterval,
            targetCount: config.ohlcvTargets.length,
            targets: config.ohlcvTargets,
          },
          customPair: {
            enabled: config.enableCustomPairRefresh,
            interval: config.customPairRefreshInterval,
            targetCount: config.customPairTargets.length,
            targets: config.customPairTargets,
          },
        },
        coalescing: {
          ...coalescingStats,
          description: 'Request coalescing deduplicates simultaneous requests to reduce load',
        },
        rateLimits: {
          ...rateLimitStats,
          description: 'App-level rate limiting per exchange to prevent API quota violations',
        },
      };

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getJobsStatus:', error);
      return errorResponse(res, `Failed to fetch job status: ${error}`, 500);
    }
  }

  /**
   * Add OHLCV target for background refresh
   *
   * Request body:
   * {
   *   "exchange": "binance",
   *   "symbol": "BTC/USDT",
   *   "timeframes": ["1m", "5m", "15m", "1h"],
   *   "marketType": "spot",
   *   "limit": 100
   * }
   *
   * @param req - Express request with target configuration
   * @param res - Express response object
   * @returns Response confirming target addition
   */
  async addOhlcvTarget(req: Request, res: Response): Promise<Response> {
    try {
      const { exchange, symbol, timeframes, marketType, limit } = req.body;

      // Validate required fields
      if (!exchange || !symbol || !timeframes || !Array.isArray(timeframes) || timeframes.length === 0) {
        return errorResponse(
          res,
          'Missing required fields: exchange, symbol, and timeframes (array) are required',
          400
        );
      }

      // Validate exchange
      const supportedExchanges: SupportedExchange[] = ['binance', 'bybit', 'okx'];
      if (!supportedExchanges.includes(exchange)) {
        return errorResponse(
          res,
          `Invalid exchange. Must be one of: ${supportedExchanges.join(', ')}`,
          400
        );
      }

      // Validate timeframes
      const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];
      for (const tf of timeframes) {
        if (!validTimeframes.includes(tf)) {
          return errorResponse(
            res,
            `Invalid timeframe "${tf}". Must be one of: ${validTimeframes.join(', ')}`,
            400
          );
        }
      }

      // Validate market type
      const validMarketTypes = ['spot', 'perp'];
      const finalMarketType = marketType || 'spot';
      if (!validMarketTypes.includes(finalMarketType)) {
        return errorResponse(
          res,
          `Invalid market type. Must be one of: ${validMarketTypes.join(', ')}`,
          400
        );
      }

      // Create target
      const target: OHLCVTarget = {
        exchange,
        symbol,
        timeframes,
        marketType: finalMarketType,
        limit: limit || 100,
      };

      // Add to background job service
      backgroundJobService.addOhlcvTarget(target);

      return successResponse(res, {
        message: 'OHLCV target added successfully',
        target,
      });
    } catch (error) {
      console.error('Error in addOhlcvTarget:', error);
      return errorResponse(res, `Failed to add OHLCV target: ${error}`, 500);
    }
  }

  /**
   * Add custom pair target for background refresh
   *
   * Request body:
   * {
   *   "exchange": "binance",
   *   "symbol1": "BTC/USDT",
   *   "symbol2": "AVAX/USDT",
   *   "timeframes": ["1m", "5m", "15m", "1h"],
   *   "marketType": "spot",
   *   "limit": 100
   * }
   *
   * @param req - Express request with target configuration
   * @param res - Express response object
   * @returns Response confirming target addition
   */
  async addCustomPairTarget(req: Request, res: Response): Promise<Response> {
    try {
      const { exchange, symbol1, symbol2, timeframes, marketType, limit } = req.body;

      // Validate required fields
      if (
        !exchange ||
        !symbol1 ||
        !symbol2 ||
        !timeframes ||
        !Array.isArray(timeframes) ||
        timeframes.length === 0
      ) {
        return errorResponse(
          res,
          'Missing required fields: exchange, symbol1, symbol2, and timeframes (array) are required',
          400
        );
      }

      // Validate exchange
      const supportedExchanges: SupportedExchange[] = ['binance', 'bybit', 'okx'];
      if (!supportedExchanges.includes(exchange)) {
        return errorResponse(
          res,
          `Invalid exchange. Must be one of: ${supportedExchanges.join(', ')}`,
          400
        );
      }

      // Validate timeframes
      const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];
      for (const tf of timeframes) {
        if (!validTimeframes.includes(tf)) {
          return errorResponse(
            res,
            `Invalid timeframe "${tf}". Must be one of: ${validTimeframes.join(', ')}`,
            400
          );
        }
      }

      // Validate market type
      const validMarketTypes = ['spot', 'perp'];
      const finalMarketType = marketType || 'spot';
      if (!validMarketTypes.includes(finalMarketType)) {
        return errorResponse(
          res,
          `Invalid market type. Must be one of: ${validMarketTypes.join(', ')}`,
          400
        );
      }

      // Create target
      const target: CustomPairTarget = {
        exchange,
        symbol1,
        symbol2,
        timeframes,
        marketType: finalMarketType,
        limit: limit || 100,
      };

      // Add to background job service
      backgroundJobService.addCustomPairTarget(target);

      return successResponse(res, {
        message: 'Custom pair target added successfully',
        target,
      });
    } catch (error) {
      console.error('Error in addCustomPairTarget:', error);
      return errorResponse(res, `Failed to add custom pair target: ${error}`, 500);
    }
  }

  /**
   * Update background job configuration
   *
   * Request body (all fields optional):
   * {
   *   "tickerRefreshInterval": 5000,
   *   "enableTickerRefresh": true,
   *   "ohlcvRefreshInterval": 5000,
   *   "enableOhlcvRefresh": true,
   *   "customPairRefreshInterval": 5000,
   *   "enableCustomPairRefresh": true
   * }
   *
   * @param req - Express request with configuration updates
   * @param res - Express response object
   * @returns Response confirming configuration update
   */
  async updateJobConfig(req: Request, res: Response): Promise<Response> {
    try {
      const updates = req.body;

      // Validate interval values if provided
      const intervalFields = [
        'tickerRefreshInterval',
        'ohlcvRefreshInterval',
        'customPairRefreshInterval',
      ];

      for (const field of intervalFields) {
        if (updates[field] !== undefined) {
          const value = parseInt(updates[field], 10);
          if (isNaN(value) || value < 1000 || value > 60000) {
            return errorResponse(
              res,
              `Invalid ${field}: must be between 1000ms (1s) and 60000ms (60s)`,
              400
            );
          }
          updates[field] = value;
        }
      }

      // Validate boolean fields if provided
      const booleanFields = [
        'enableTickerRefresh',
        'enableOhlcvRefresh',
        'enableCustomPairRefresh',
      ];

      for (const field of booleanFields) {
        if (updates[field] !== undefined && typeof updates[field] !== 'boolean') {
          return errorResponse(res, `Invalid ${field}: must be a boolean value`, 400);
        }
      }

      // Apply configuration updates
      backgroundJobService.updateConfig(updates);

      // Get updated configuration
      const newConfig = backgroundJobService.getConfig();

      return successResponse(res, {
        message: 'Configuration updated successfully',
        config: {
          ticker: {
            enabled: newConfig.enableTickerRefresh,
            interval: newConfig.tickerRefreshInterval,
          },
          ohlcv: {
            enabled: newConfig.enableOhlcvRefresh,
            interval: newConfig.ohlcvRefreshInterval,
          },
          customPair: {
            enabled: newConfig.enableCustomPairRefresh,
            interval: newConfig.customPairRefreshInterval,
          },
        },
      });
    } catch (error) {
      console.error('Error in updateJobConfig:', error);
      return errorResponse(res, `Failed to update job configuration: ${error}`, 500);
    }
  }
}

// Export singleton instance for use in routes
export const jobsController = new JobsController();
