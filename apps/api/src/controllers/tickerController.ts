import { Request, Response } from 'express';
import { ccxtService } from '../services/ccxtService';
import { hyperliquidService } from '../services/hyperliquidService';
import { successResponse, errorResponse } from '../utils/response';
import { SupportedExchange } from '../types';

/**
 * Controller for ticker and market data endpoints
 * Routes requests to appropriate exchange services based on exchange parameter
 */
export class TickerController {
  /**
   * Get all ticker data for a specific exchange
   * @param req - Express request with exchange parameter
   * @param res - Express response object
   * @returns Response with array of all tickers for the exchange
   */
  async getAllTickers(req: Request, res: Response): Promise<Response> {
    try {
      // Extract and normalize exchange parameter
      const { exchange } = req.params;
      const exchangeId = exchange.toLowerCase() as SupportedExchange;

      let tickers;

      // Route to appropriate service based on exchange type
      switch (exchangeId) {
        case 'binance':
        case 'bybit':
        case 'okx':
          tickers = await ccxtService.getAllTickers(exchangeId);
          break;
        case 'hyperliquid':
          tickers = await hyperliquidService.getAllTickers();
          break;
        default:
          return errorResponse(res, `Exchange ${exchange} not supported`, 400);
      }

      // Return structured response matching TickersResponse interface
      const response = {
        exchange: exchangeId,
        tickers,
        count: tickers.length,
      };

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getAllTickers:', error);
      return errorResponse(res, `Failed to fetch tickers: ${error}`, 500);
    }
  }

  /**
   * Get ticker data for a specific symbol on an exchange
   * @param req - Express request with exchange and symbol parameters
   * @param res - Express response object
   * @returns Response with ticker data or 404 if not found
   */
  async getTicker(req: Request, res: Response): Promise<Response> {
    try {
      // Extract exchange and symbol parameters
      const { exchange, symbol } = req.params;
      const exchangeId = exchange.toLowerCase() as SupportedExchange;

      let ticker;
      
      // Route to appropriate service based on exchange type
      switch (exchangeId) {
        case 'binance':
        case 'bybit':
        case 'okx':
          ticker = await ccxtService.getTicker(exchangeId, symbol);
          break;
        case 'hyperliquid':
          ticker = await hyperliquidService.getTicker(symbol);
          break;
        default:
          return errorResponse(res, `Exchange ${exchange} not supported`, 400);
      }

      if (!ticker) {
        return errorResponse(res, `Ticker ${symbol} not found on ${exchange}`, 404);
      }

      return successResponse(res, ticker);
    } catch (error) {
      console.error('Error in getTicker:', error);
      return errorResponse(res, `Failed to fetch ticker: ${error}`, 500);
    }
  }

  /**
   * Get all available markets (trading pairs) for an exchange
   * @param req - Express request with exchange parameter
   * @param res - Express response object
   * @returns Response with array of market information
   */
  async getMarkets(req: Request, res: Response): Promise<Response> {
    try {
      // Extract and normalize exchange parameter
      const { exchange } = req.params;
      const exchangeId = exchange.toLowerCase() as SupportedExchange;

      let markets;

      // Route to appropriate service based on exchange type
      switch (exchangeId) {
        case 'binance':
        case 'bybit':
        case 'okx':
          markets = await ccxtService.getMarkets(exchangeId);
          break;
        case 'hyperliquid':
          markets = await hyperliquidService.getMarkets();
          break;
        default:
          return errorResponse(res, `Exchange ${exchange} not supported`, 400);
      }

      // Return structured response matching MarketsResponse interface
      const response = {
        exchange: exchangeId,
        markets,
        count: markets.length,
      };

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getMarkets:', error);
      return errorResponse(res, `Failed to fetch markets: ${error}`, 500);
    }
  }
}

// Export singleton instance for use in routes
export const tickerController = new TickerController();