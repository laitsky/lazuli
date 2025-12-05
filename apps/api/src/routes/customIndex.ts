/**
 * Custom Index Routes for Elysia
 * Handles API requests for custom index creation and performance calculation
 */

import { Elysia, t } from 'elysia';
import { customIndexService } from '../services/customIndexService';
import { successResponse } from '../utils/response';
import { SupportedExchange, Timeframe, IndexAsset } from '@lazuli/shared';
import { validateExchange, validateInteger } from '../utils/validation';
import {
  invalidExchange,
  invalidTimeframe,
  invalidParameter,
  missingParameter,
  invalidWeights,
} from '../errors';

// Valid timeframes
const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

/**
 * Custom index routes plugin
 */
export const customIndexRoutes = new Elysia({ prefix: '/custom-index' })
  // POST /api/v1/custom-index - Calculate custom index performance
  .post(
    '/',
    async ({ body }) => {
      const { name, exchange, timeframe, assets, limit } = body;

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

      return successResponse(result);
    },
    {
      body: t.Object({
        name: t.String(),
        exchange: t.String(),
        timeframe: t.String(),
        assets: t.Array(
          t.Object({
            symbol: t.String(),
            weight: t.Number(),
          })
        ),
        limit: t.Optional(t.Number()),
      }),
    }
  );
