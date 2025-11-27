/**
 * Funding Rate Controller
 *
 * Handles HTTP requests for funding rate analytics endpoints.
 * Provides funding rate data for perpetual futures markets.
 *
 * Endpoints:
 * - GET /api/v1/funding/:exchange - Get funding rates for an exchange
 * - GET /api/v1/funding/compare - Get cross-exchange funding rate comparison
 */

import { Request, Response } from 'express';
import { fundingRateService } from '../services/fundingRateService';
import { successResponse, errorResponse } from '../utils/response';
import { validateExchange, validateInteger, validateSortOrder } from '../utils/validation';

/**
 * Valid sort fields for funding rate data
 */
type FundingSortBy = 'rate' | 'volume' | 'openInterest';

/**
 * Validate sort by field for funding rates
 */
function validateFundingSortBy(value: any): FundingSortBy {
  const validFields: FundingSortBy[] = ['rate', 'volume', 'openInterest'];
  if (typeof value === 'string' && validFields.includes(value as FundingSortBy)) {
    return value as FundingSortBy;
  }
  return 'rate'; // Default to sorting by absolute funding rate
}

/**
 * Funding Rate Controller class
 * Handles all funding rate related API endpoints
 */
export class FundingRateController {
  /**
   * Get funding rates for all perpetual contracts on an exchange
   *
   * Query parameters:
   * - sortBy: Sort field ('rate', 'volume', 'openInterest', default: 'rate')
   * - sortOrder: Sort order ('asc' or 'desc', default: 'desc')
   * - limit: Maximum results (default: 100, max: 500)
   *
   * @param req - Express request with exchange parameter and query params
   * @param res - Express response object
   * @returns Response with funding rate data and statistics
   *
   * @example
   * GET /api/v1/funding/binance
   * GET /api/v1/funding/binance?sortBy=volume&sortOrder=desc&limit=50
   */
  async getFundingRates(req: Request, res: Response): Promise<Response> {
    try {
      // Validate exchange parameter
      const exchangeId = validateExchange(req.params.exchange);

      if (!exchangeId) {
        return errorResponse(res, `Exchange ${req.params.exchange} not supported`, 400);
      }

      // Validate query parameters
      const sortBy = validateFundingSortBy(req.query.sortBy);
      const sortOrder = validateSortOrder(req.query.sortOrder);
      const limit = validateInteger(req.query.limit, 100, 1, 500);

      // Fetch funding rates from service
      const fundingData = await fundingRateService.getFundingRates(
        exchangeId,
        sortBy,
        sortOrder,
        limit
      );

      return successResponse(res, fundingData);
    } catch (error) {
      console.error('Error in getFundingRates:', error);
      return errorResponse(
        res,
        `Failed to fetch funding rates: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Get cross-exchange funding rate comparison
   * Compares funding rates across all supported exchanges for arbitrage opportunities
   *
   * Query parameters:
   * - limit: Maximum assets to compare (default: 50, max: 200)
   *
   * @param req - Express request
   * @param res - Express response object
   * @returns Response with cross-exchange comparisons and arbitrage opportunities
   *
   * @example
   * GET /api/v1/funding/compare
   * GET /api/v1/funding/compare?limit=100
   */
  async getCrossExchangeFunding(req: Request, res: Response): Promise<Response> {
    try {
      // Validate query parameters
      const limit = validateInteger(req.query.limit, 50, 1, 200);

      // Fetch cross-exchange funding comparison
      const comparisonData = await fundingRateService.getCrossExchangeFunding(limit);

      return successResponse(res, comparisonData);
    } catch (error) {
      console.error('Error in getCrossExchangeFunding:', error);
      return errorResponse(
        res,
        `Failed to fetch cross-exchange funding: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }
}

// Export singleton instance for use in routes
export const fundingRateController = new FundingRateController();
