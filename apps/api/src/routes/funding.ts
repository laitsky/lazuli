/**
 * Funding Rate Routes for Elysia
 * Handles funding rate analytics endpoints for perpetual futures
 */

import { Elysia, t } from 'elysia';
import { fundingRateService } from '../services/fundingRateService';
import { successResponse } from '../utils/response';
import { validateExchange, validateInteger, validateSortOrder } from '../utils/validation';
import { invalidExchange } from '../errors';

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
  return 'rate';
}

/**
 * Funding rate routes plugin
 */
export const fundingRoutes = new Elysia({ prefix: '/funding' })
  // GET /api/v1/funding/compare - Get cross-exchange funding rate comparison
  // Must be before :exchange route to avoid matching "compare" as an exchange
  .get(
    '/compare',
    async ({ query }) => {
      const limit = validateInteger(query.limit, 50, 1, 200);
      const comparisonData = await fundingRateService.getCrossExchangeFunding(limit);
      return successResponse(comparisonData);
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
    }
  )
  // GET /api/v1/funding/:exchange - Get funding rates for an exchange
  .get(
    '/:exchange',
    async ({ params, query }) => {
      const exchangeId = validateExchange(params.exchange);

      if (!exchangeId) {
        throw invalidExchange(params.exchange);
      }

      const sortBy = validateFundingSortBy(query.sortBy);
      const sortOrder = validateSortOrder(query.sortOrder);
      const limit = validateInteger(query.limit, 100, 1, 500);

      const fundingData = await fundingRateService.getFundingRates(
        exchangeId,
        sortBy,
        sortOrder,
        limit
      );

      return successResponse(fundingData);
    },
    {
      params: t.Object({
        exchange: t.String(),
      }),
      query: t.Object({
        sortBy: t.Optional(t.String()),
        sortOrder: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  );
