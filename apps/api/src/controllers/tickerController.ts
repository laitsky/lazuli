import { Request, Response } from 'express';
import { ccxtService } from '../services/ccxtService';
import { hyperliquidService } from '../services/hyperliquidService';
import { cacheService } from '../services/cacheService';
import { successResponse, errorResponse } from '../utils/response';
import { SupportedExchange, Ticker, PaginationMeta } from '@lazuli/shared';

/**
 * Controller for ticker and market data endpoints
 * Routes requests to appropriate exchange services based on exchange parameter
 */
export class TickerController {
  /**
   * Get all ticker data for a specific exchange with pagination and filtering
   *
   * Query parameters:
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 100, max: 500)
   * - type: Filter by market type ('spot' or 'perp')
   * - search: Search by symbol (case-insensitive)
   * - sortBy: Sort field ('volume', 'price', 'change', default: 'volume')
   * - sortOrder: Sort order ('asc' or 'desc', default: 'desc')
   *
   * @param req - Express request with exchange parameter and query params
   * @param res - Express response object
   * @returns Response with paginated and filtered tickers
   */
  async getAllTickers(req: Request, res: Response): Promise<Response> {
    try {
      // Extract and normalize exchange parameter
      const { exchange } = req.params;
      const exchangeId = exchange.toLowerCase() as SupportedExchange;

      // Validate exchange
      if (!['binance', 'bybit', 'okx', 'hyperliquid'].includes(exchangeId)) {
        return errorResponse(res, `Exchange ${exchange} not supported`, 400);
      }

      // Parse query parameters with defaults
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
      const typeFilter = req.query.type as 'spot' | 'perp' | undefined;
      const searchQuery = (req.query.search as string)?.toLowerCase().trim();
      const sortBy = (req.query.sortBy as string) || 'volume';
      const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'desc';

      // Try to get tickers from cache first (30 second TTL)
      const cacheKey = `tickers:${exchangeId}`;
      let allTickers = cacheService.get<Ticker[]>(cacheKey);

      // If not cached, fetch from exchange
      if (!allTickers) {
        console.log(`Cache miss for ${cacheKey}, fetching from exchange...`);

        switch (exchangeId) {
          case 'binance':
          case 'bybit':
          case 'okx':
            allTickers = await ccxtService.getAllTickers(exchangeId);
            break;
          case 'hyperliquid':
            allTickers = await hyperliquidService.getAllTickers();
            break;
        }

        // Cache the results for 30 seconds
        cacheService.set(cacheKey, allTickers, 30000);
      } else {
        console.log(`Cache hit for ${cacheKey}`);
      }

      // Apply filters
      let filteredTickers = allTickers;

      // Filter by type (spot/perp)
      if (typeFilter && (typeFilter === 'spot' || typeFilter === 'perp')) {
        filteredTickers = filteredTickers.filter(t => t.type === typeFilter);
      }

      // Filter by search query (symbol)
      if (searchQuery) {
        filteredTickers = filteredTickers.filter(t =>
          t.symbol.toLowerCase().includes(searchQuery)
        );
      }

      // Apply sorting
      filteredTickers = this.sortTickers(filteredTickers, sortBy, sortOrder);

      // Calculate pagination
      const total = filteredTickers.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;

      // Get paginated slice
      const paginatedTickers = filteredTickers.slice(startIndex, endIndex);

      // Build pagination metadata
      const pagination: PaginationMeta = {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };

      // Return structured response matching TickersResponse interface
      const response = {
        exchange: exchangeId,
        tickers: paginatedTickers,
        count: paginatedTickers.length,
        pagination,
        filters: {
          type: typeFilter,
          search: searchQuery,
          sortBy,
          sortOrder,
        },
      };

      return successResponse(res, response);
    } catch (error) {
      console.error('Error in getAllTickers:', error);
      return errorResponse(res, `Failed to fetch tickers: ${error}`, 500);
    }
  }

  /**
   * Sort tickers by specified field and order
   * @param tickers - Array of tickers to sort
   * @param sortBy - Field to sort by
   * @param sortOrder - Sort order (asc/desc)
   * @returns Sorted array of tickers
   */
  private sortTickers(tickers: Ticker[], sortBy: string, sortOrder: 'asc' | 'desc'): Ticker[] {
    const sorted = [...tickers].sort((a, b) => {
      let aValue: number | null = null;
      let bValue: number | null = null;

      switch (sortBy) {
        case 'volume':
          aValue = a.volume24h;
          bValue = b.volume24h;
          break;
        case 'price':
          aValue = a.last;
          bValue = b.last;
          break;
        case 'change':
          aValue = a.percentage24h;
          bValue = b.percentage24h;
          break;
        default:
          aValue = a.volume24h;
          bValue = b.volume24h;
      }

      // Handle null values (put them at the end)
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;

      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
    });

    return sorted;
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
   * Get all available markets (trading pairs) for an exchange with pagination and filtering
   *
   * Query parameters:
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 100, max: 500)
   * - type: Filter by market type ('spot' or 'perp')
   * - search: Search by symbol (case-insensitive)
   * - active: Filter by active status (true/false)
   *
   * @param req - Express request with exchange parameter and query params
   * @param res - Express response object
   * @returns Response with paginated and filtered markets
   */
  async getMarkets(req: Request, res: Response): Promise<Response> {
    try {
      // Extract and normalize exchange parameter
      const { exchange } = req.params;
      const exchangeId = exchange.toLowerCase() as SupportedExchange;

      // Validate exchange
      if (!['binance', 'bybit', 'okx', 'hyperliquid'].includes(exchangeId)) {
        return errorResponse(res, `Exchange ${exchange} not supported`, 400);
      }

      // Parse query parameters with defaults
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
      const typeFilter = req.query.type as 'spot' | 'perp' | undefined;
      const searchQuery = (req.query.search as string)?.toLowerCase().trim();
      const activeFilter = req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined;

      // Try to get markets from cache first (5 minute TTL, markets don't change often)
      const cacheKey = `markets:${exchangeId}`;
      let allMarkets = cacheService.get<any[]>(cacheKey);

      // If not cached, fetch from exchange
      if (!allMarkets) {
        console.log(`Cache miss for ${cacheKey}, fetching from exchange...`);

        switch (exchangeId) {
          case 'binance':
          case 'bybit':
          case 'okx':
            allMarkets = await ccxtService.getMarkets(exchangeId);
            break;
          case 'hyperliquid':
            allMarkets = await hyperliquidService.getMarkets();
            break;
        }

        // Cache the results for 5 minutes (markets don't change frequently)
        cacheService.set(cacheKey, allMarkets, 300000);
      } else {
        console.log(`Cache hit for ${cacheKey}`);
      }

      // Apply filters
      let filteredMarkets = allMarkets;

      // Filter by type (spot/perp)
      if (typeFilter && (typeFilter === 'spot' || typeFilter === 'perp')) {
        filteredMarkets = filteredMarkets.filter(m => m.type === typeFilter);
      }

      // Filter by active status
      if (activeFilter !== undefined) {
        filteredMarkets = filteredMarkets.filter(m => m.active === activeFilter);
      }

      // Filter by search query (symbol)
      if (searchQuery) {
        filteredMarkets = filteredMarkets.filter(m =>
          m.symbol.toLowerCase().includes(searchQuery)
        );
      }

      // Calculate pagination
      const total = filteredMarkets.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;

      // Get paginated slice
      const paginatedMarkets = filteredMarkets.slice(startIndex, endIndex);

      // Build pagination metadata
      const pagination: PaginationMeta = {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };

      // Return structured response matching MarketsResponse interface
      const response = {
        exchange: exchangeId,
        markets: paginatedMarkets,
        count: paginatedMarkets.length,
        pagination,
        filters: {
          type: typeFilter,
          search: searchQuery,
          active: activeFilter,
        },
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