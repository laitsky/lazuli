/**
 * Custom Index Controller
 * Handles API requests for custom index creation and performance calculation
 * Allows users to create weighted baskets of coins and compare performance
 */

import { Request, Response } from 'express';
import { customIndexService } from '../services/customIndexService';
import { successResponse, errorResponse } from '../utils/response';
import { SupportedExchange, Timeframe, IndexAsset } from '@lazuli/shared';
import { validateExchange, validateInteger } from '../utils/validation';

export class CustomIndexController {
  /**
   * Calculate custom index performance
   *
   * POST /api/v1/custom-index
   *
   * Request body:
   * {
   *   "name": "My Index",
   *   "exchange": "binance",
   *   "timeframe": "1h",
   *   "assets": [
   *     { "symbol": "BTC-USDT", "weight": 50 },
   *     { "symbol": "ETH-USDT", "weight": 30 },
   *     { "symbol": "SOL-USDT", "weight": 20 }
   *   ],
   *   "limit": 100
   * }
   *
   * @param req - Express request with index configuration in body
   * @param res - Express response object
   * @returns Response with index performance and benchmark comparisons
   */
  async calculateIndex(req: Request, res: Response): Promise<Response> {
    try {
      // Extract and validate request body
      const { name, exchange, timeframe, assets, limit } = req.body;

      // Validate required fields
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return errorResponse(res, 'Index name is required', 400);
      }

      // Validate exchange
      const exchangeId = validateExchange(exchange);
      if (!exchangeId) {
        return errorResponse(
          res,
          `Exchange ${exchange} not supported. Use: binance, bybit, okx`,
          400
        );
      }

      // Validate timeframe
      const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];
      if (!timeframe || !validTimeframes.includes(timeframe as Timeframe)) {
        return errorResponse(
          res,
          `Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`,
          400
        );
      }

      // Validate assets array
      if (!assets || !Array.isArray(assets) || assets.length === 0) {
        return errorResponse(res, 'Assets array is required and must not be empty', 400);
      }

      if (assets.length > 20) {
        return errorResponse(res, 'Maximum 20 assets allowed in an index', 400);
      }

      // Validate each asset
      const validatedAssets: IndexAsset[] = [];
      for (const asset of assets) {
        if (!asset.symbol || typeof asset.symbol !== 'string') {
          return errorResponse(res, 'Each asset must have a valid symbol', 400);
        }

        const weight = Number(asset.weight);
        if (isNaN(weight) || weight <= 0 || weight > 100) {
          return errorResponse(
            res,
            `Invalid weight for ${asset.symbol}. Must be between 0 and 100`,
            400
          );
        }

        validatedAssets.push({
          symbol: asset.symbol.trim(),
          weight,
        });
      }

      // Validate weights sum to 100
      const totalWeight = validatedAssets.reduce((sum, a) => sum + a.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        return errorResponse(
          res,
          `Asset weights must sum to 100, got ${totalWeight.toFixed(2)}`,
          400
        );
      }

      // Validate limit
      const validatedLimit = validateInteger(limit, 100, 1, 500);

      // Calculate index performance
      const result = await customIndexService.calculateIndex(
        name.trim(),
        validatedAssets,
        timeframe as Timeframe,
        exchangeId as SupportedExchange,
        validatedLimit
      );

      return successResponse(res, result);
    } catch (error) {
      console.error('Error in calculateIndex:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return errorResponse(res, `Failed to calculate index: ${errorMessage}`, 500);
    }
  }
}

// Export singleton instance for use in routes
export const customIndexController = new CustomIndexController();
