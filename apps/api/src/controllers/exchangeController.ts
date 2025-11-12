import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import { ExchangeInfo } from '../types';

/**
 * Controller for exchange-related endpoints
 * Handles requests for exchange information and capabilities
 */
export class ExchangeController {
  /**
   * Get list of all supported exchanges with their capabilities
   * @param _req - Express request object (unused)
   * @param res - Express response object
   * @returns Response with array of exchange information
   */
  async listExchanges(_req: Request, res: Response): Promise<Response> {
    try {
      // Static list of supported exchanges and their capabilities
      const exchanges: ExchangeInfo[] = [
        {
          name: 'Binance',
          id: 'binance',
          supported: true,
          hasSpot: true,
          hasPerp: true,
        },
        {
          name: 'Bybit',
          id: 'bybit',
          supported: true,
          hasSpot: true,
          hasPerp: true,
        },
        {
          name: 'OKX',
          id: 'okx',
          supported: true,
          hasSpot: true,
          hasPerp: true,
        },
      ];

      return successResponse(res, exchanges);
    } catch (error) {
      return errorResponse(res, 'Failed to list exchanges', 500);
    }
  }
}

// Export singleton instance for use in routes
export const exchangeController = new ExchangeController();