import axios from 'axios';
import { Ticker, Market } from '../types';

/**
 * Hyperliquid API metadata response structure
 * Contains information about available trading pairs
 */
interface HyperliquidMeta {
  universe: Array<{
    name: string;
    szDecimals: number;
  }>;
}

/**
 * Hyperliquid asset context data structure
 * Contains real-time market data for each trading pair
 */
interface HyperliquidAssetCtx {
  dayNtlVlm: string;
  funding: string;
  impactPxs: string[];
  markPx: string;
  midPx: string;
  openInterest: string;
  oraclePx: string;
  premium: string;
  prevDayPx: string;
}

/**
 * Service class for integrating with Hyperliquid DEX
 * Handles perpetual futures market data from their custom API
 * Note: Hyperliquid only offers perpetual futures, no spot trading
 */
export class HyperliquidService {
  // Hyperliquid API endpoint for market data
  private readonly baseUrl = 'https://api.hyperliquid.xyz/info';
  // Cached metadata to avoid repeated API calls
  private metaData: HyperliquidMeta | null = null;

  /**
   * Load and cache Hyperliquid market metadata
   * Required before fetching market or ticker data
   */
  async loadMeta(): Promise<void> {
    try {
      const response = await axios.post(this.baseUrl, {
        type: 'meta',
      });
      this.metaData = response.data;
    } catch (error) {
      console.error('Error loading Hyperliquid meta:', error);
      throw error;
    }
  }

  /**
   * Fetch all available tickers from Hyperliquid
   * Returns perpetual futures market data with funding rates and open interest
   * @returns Array of ticker objects for all available perpetual markets
   */
  async getAllTickers(): Promise<Ticker[]> {
    try {
      if (!this.metaData) {
        await this.loadMeta();
      }

      // Fetch all market data (mid prices, funding rates, etc.)
      const response = await axios.post(this.baseUrl, {
        type: 'allMids',
      });

      const assetCtxs: { [key: string]: HyperliquidAssetCtx } = response.data;
      
      // Transform Hyperliquid data format to our standardized ticker format
      return Object.entries(assetCtxs).map(([symbol, ctx]) => {
        // Parse price data and calculate 24h change
        const midPrice = parseFloat(ctx.midPx);
        const markPrice = parseFloat(ctx.markPx);
        const prevDayPrice = parseFloat(ctx.prevDayPx);
        const change24h = markPrice - prevDayPrice;
        const percentage24h = prevDayPrice !== 0 ? (change24h / prevDayPrice) * 100 : 0;

        return {
          symbol: symbol,
          exchange: 'hyperliquid',
          type: 'perp' as const,
          bid: midPrice,
          ask: midPrice,
          last: markPrice,
          high24h: null,
          low24h: null,
          volume24h: parseFloat(ctx.dayNtlVlm),
          quoteVolume24h: null,
          change24h,
          percentage24h,
          timestamp: Date.now(),
          fundingRate: parseFloat(ctx.funding),
          openInterest: parseFloat(ctx.openInterest),
        };
      });
    } catch (error) {
      console.error('Error fetching Hyperliquid tickers:', error);
      throw error;
    }
  }

  /**
   * Get all available markets (trading pairs) on Hyperliquid
   * @returns Array of market objects for all perpetual futures
   */
  async getMarkets(): Promise<Market[]> {
    try {
      if (!this.metaData) {
        await this.loadMeta();
      }

      // Transform metadata to market format (all markets are perpetual futures)
      return this.metaData!.universe.map(asset => ({
        id: asset.name,
        symbol: asset.name,
        base: asset.name,
        quote: 'USD',
        type: 'perp' as const,
        active: true,
        exchange: 'hyperliquid',
      }));
    } catch (error) {
      console.error('Error fetching Hyperliquid markets:', error);
      throw error;
    }
  }

  /**
   * Get ticker data for a specific symbol on Hyperliquid
   * @param symbol - Trading pair symbol (e.g., 'BTC')
   * @returns Ticker object or null if not found
   */
  async getTicker(symbol: string): Promise<Ticker | null> {
    try {
      const allTickers = await this.getAllTickers();
      return allTickers.find(t => t.symbol === symbol) || null;
    } catch (error) {
      console.error(`Error fetching Hyperliquid ticker ${symbol}:`, error);
      throw error;
    }
  }
}

// Export singleton instance for use across the application
export const hyperliquidService = new HyperliquidService();