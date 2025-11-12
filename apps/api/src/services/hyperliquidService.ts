import axios from 'axios';
import { Ticker, Market, OHLCV, Timeframe } from '../types';

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

  /**
   * Convert our standardized timeframe format to Hyperliquid's interval format
   * @param timeframe - Our timeframe format (1m, 5m, 15m, etc.)
   * @returns Hyperliquid interval string
   */
  private convertTimeframe(timeframe: Timeframe): string {
    // Hyperliquid uses intervals like '1m', '1h', '1d' (similar to our format)
    const mapping: Record<Timeframe, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
      '3d': '3d',
      '1w': '1w',
    };
    return mapping[timeframe];
  }

  /**
   * Fetch OHLCV (candlestick) data for a specific symbol and timeframe
   * @param symbol - Trading pair symbol (e.g., 'BTC')
   * @param timeframe - Timeframe for candles (1m, 5m, 15m, 1h, 4h, 1d, 3d, 1w)
   * @param limit - Number of candles to fetch (default: 100)
   * @returns Array of OHLCV candles
   */
  async fetchOHLCV(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 100
  ): Promise<OHLCV[]> {
    try {
      // Convert timeframe to Hyperliquid format
      const interval = this.convertTimeframe(timeframe);

      // Calculate start time for the request (going back in time based on limit)
      const now = Date.now();
      const endTime = now;

      // Make API request for candlestick data
      const response = await axios.post(this.baseUrl, {
        type: 'candleSnapshot',
        req: {
          coin: symbol,
          interval: interval,
          startTime: 0,  // Hyperliquid will return the most recent candles up to limit
          endTime: endTime,
        },
      });

      // Hyperliquid returns array of candles with structure:
      // [{ t: timestamp, T: endTimestamp, s: symbol, i: interval, o: open, c: close, h: high, l: low, v: volume, n: trades }]
      const candles = response.data || [];

      // Transform Hyperliquid format to our standardized OHLCV format
      // Sort by timestamp and take the most recent `limit` candles
      return candles
        .map((candle: any) => ({
          timestamp: candle.t,      // Timestamp in milliseconds
          open: parseFloat(candle.o),    // Opening price
          high: parseFloat(candle.h),    // Highest price
          low: parseFloat(candle.l),     // Lowest price
          close: parseFloat(candle.c),   // Closing price
          volume: parseFloat(candle.v),  // Volume
        }))
        .sort((a: OHLCV, b: OHLCV) => a.timestamp - b.timestamp)  // Sort by timestamp ascending
        .slice(-limit);  // Take the most recent candles up to limit
    } catch (error) {
      console.error(`Error fetching OHLCV for ${symbol} on Hyperliquid:`, error);
      throw error;
    }
  }
}

// Export singleton instance for use across the application
export const hyperliquidService = new HyperliquidService();