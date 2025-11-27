/**
 * Custom Index Controller
 * Handles API requests for custom index creation and performance calculation
 * Allows users to create weighted baskets of coins and compare performance
 */

import { Request, Response } from 'express';
import { customIndexService } from '../services/customIndexService';
import { successResponse, handleError } from '../utils/response';
import { SupportedExchange, Timeframe, IndexAsset } from '@lazuli/shared';
import { validateExchange, validateInteger } from '../utils/validation';
import {
  invalidExchange,
  invalidTimeframe,
  invalidParameter,
  missingParameter,
  invalidWeights,
} from '../errors';

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
        throw missingParameter('name');
      }

      // Validate exchange
      const exchangeId = validateExchange(exchange);
      if (!exchangeId) {
        throw invalidExchange(exchange);
      }

      // Validate timeframe
      const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];
      if (!timeframe || !validTimeframes.includes(timeframe as Timeframe)) {
        throw invalidTimeframe(timeframe || '', validTimeframes);
      }

      // Validate assets array
      if (!assets || !Array.isArray(assets) || assets.length === 0) {
        throw invalidParameter('assets', 'Assets array is required and must not be empty');
      }

      if (assets.length > 20) {
        throw invalidParameter('assets', 'Maximum 20 assets allowed in an index');
      }

      // Validate each asset
      const validatedAssets: IndexAsset[] = [];
      for (const asset of assets) {
        if (!asset.symbol || typeof asset.symbol !== 'string') {
          throw invalidParameter('assets', 'Each asset must have a valid symbol');
        }

        const weight = Number(asset.weight);
        if (isNaN(weight) || weight <= 0 || weight > 100) {
          throw invalidParameter(
            'weight',
            `Invalid weight for ${asset.symbol}. Must be between 0 and 100`
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
        throw invalidWeights(`Asset weights must sum to 100, got ${totalWeight.toFixed(2)}`);
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
      return handleError(res, error, 'Failed to calculate index');
    }
  }
}

// Export singleton instance for use in routes
export const customIndexController = new CustomIndexController();
