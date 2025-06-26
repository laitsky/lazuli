import { supabase } from '../utils/supabase';
import { Ticker, Market } from '../types';

/**
 * Database service for managing ticker and market data
 * Provides programmatic access to store and retrieve trading data
 * 
 * NOTE: Database features are OPTIONAL - only use if you need:
 * - Historical data storage
 * - Price alerts
 * - Arbitrage tracking
 * - Custom analytics
 * 
 * For live trading data, use the direct exchange endpoints instead.
 */
export class DatabaseService {
  
  /**
   * Store ticker data in the database
   * @param ticker - Ticker object to store
   * @returns Promise<boolean> - True if successful
   */
  async storeTicker(ticker: Ticker): Promise<boolean> {
    try {
      const { error } = await supabase.from('tickers').insert({
        symbol: ticker.symbol,
        exchange: ticker.exchange,
        type: ticker.type,
        bid: ticker.bid,
        ask: ticker.ask,
        last: ticker.last,
        high24h: ticker.high24h,
        low24h: ticker.low24h,
        volume24h: ticker.volume24h,
        quote_volume24h: ticker.quoteVolume24h,
        change24h: ticker.change24h,
        percentage24h: ticker.percentage24h,
        funding_rate: ticker.fundingRate,
        open_interest: ticker.openInterest,
      });

      if (error) {
        console.error('Error storing ticker:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Exception storing ticker:', error);
      return false;
    }
  }

  /**
   * Store multiple tickers in batch
   * @param tickers - Array of ticker objects
   * @returns Promise<number> - Number of successfully stored tickers
   */
  async storeTickers(tickers: Ticker[]): Promise<number> {
    try {
      const tickerData = tickers.map(ticker => ({
        symbol: ticker.symbol,
        exchange: ticker.exchange,
        type: ticker.type,
        bid: ticker.bid,
        ask: ticker.ask,
        last: ticker.last,
        high24h: ticker.high24h,
        low24h: ticker.low24h,
        volume24h: ticker.volume24h,
        quote_volume24h: ticker.quoteVolume24h,
        change24h: ticker.change24h,
        percentage24h: ticker.percentage24h,
        funding_rate: ticker.fundingRate,
        open_interest: ticker.openInterest,
      }));

      const { error } = await supabase.from('tickers').insert(tickerData);

      if (error) {
        console.error('Error storing tickers batch:', error);
        return 0;
      }

      console.log(`✅ Stored ${tickers.length} tickers successfully`);
      return tickers.length;
    } catch (error) {
      console.error('Exception storing tickers batch:', error);
      return 0;
    }
  }

  /**
   * Store market information
   * @param market - Market object to store
   * @returns Promise<boolean> - True if successful
   */
  async storeMarket(market: Market): Promise<boolean> {
    try {
      const { error } = await supabase.from('markets').upsert({
        id: market.id,
        symbol: market.symbol,
        base: market.base,
        quote: market.quote,
        type: market.type,
        active: market.active,
        exchange: market.exchange,
      });

      if (error) {
        console.error('Error storing market:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Exception storing market:', error);
      return false;
    }
  }

  /**
   * Store multiple markets in batch
   * @param markets - Array of market objects
   * @returns Promise<number> - Number of successfully stored markets
   */
  async storeMarkets(markets: Market[]): Promise<number> {
    try {
      const marketData = markets.map(market => ({
        id: market.id,
        symbol: market.symbol,
        base: market.base,
        quote: market.quote,
        type: market.type,
        active: market.active,
        exchange: market.exchange,
      }));

      const { error } = await supabase.from('markets').upsert(marketData);

      if (error) {
        console.error('Error storing markets batch:', error);
        return 0;
      }

      console.log(`✅ Stored ${markets.length} markets successfully`);
      return markets.length;
    } catch (error) {
      console.error('Exception storing markets batch:', error);
      return 0;
    }
  }

  /**
   * Get historical ticker data for a symbol
   * @param symbol - Trading pair symbol
   * @param exchange - Exchange name (optional)
   * @param limit - Maximum number of records (default: 100)
   * @returns Promise<Ticker[]> - Array of historical tickers
   */
  async getHistoricalTickers(symbol: string, exchange?: string, limit = 100): Promise<Ticker[]> {
    try {
      let query = supabase
        .from('tickers')
        .select('*')
        .eq('symbol', symbol)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (exchange) {
        query = query.eq('exchange', exchange);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching historical tickers:', error);
        return [];
      }

      // Transform database records back to Ticker format
      return (data || []).map(record => ({
        symbol: record.symbol,
        exchange: record.exchange,
        type: record.type,
        bid: record.bid,
        ask: record.ask,
        last: record.last,
        high24h: record.high24h,
        low24h: record.low24h,
        volume24h: record.volume24h,
        quoteVolume24h: record.quote_volume24h,
        change24h: record.change24h,
        percentage24h: record.percentage24h,
        timestamp: new Date(record.created_at).getTime(),
        fundingRate: record.funding_rate,
        openInterest: record.open_interest,
      }));
    } catch (error) {
      console.error('Exception fetching historical tickers:', error);
      return [];
    }
  }

  /**
   * Get latest ticker for a symbol from database
   * @param symbol - Trading pair symbol
   * @param exchange - Exchange name
   * @returns Promise<Ticker | null> - Latest ticker or null
   */
  async getLatestTicker(symbol: string, exchange: string): Promise<Ticker | null> {
    try {
      const { data, error } = await supabase
        .from('tickers')
        .select('*')
        .eq('symbol', symbol)
        .eq('exchange', exchange)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) {
        return null;
      }

      const record = data[0];
      return {
        symbol: record.symbol,
        exchange: record.exchange,
        type: record.type,
        bid: record.bid,
        ask: record.ask,
        last: record.last,
        high24h: record.high24h,
        low24h: record.low24h,
        volume24h: record.volume24h,
        quoteVolume24h: record.quote_volume24h,
        change24h: record.change24h,
        percentage24h: record.percentage24h,
        timestamp: new Date(record.created_at).getTime(),
        fundingRate: record.funding_rate,
        openInterest: record.open_interest,
      };
    } catch (error) {
      console.error('Exception fetching latest ticker:', error);
      return null;
    }
  }

  /**
   * Clean up old ticker data (older than specified days)
   * @param daysToKeep - Number of days to keep (default: 30)
   * @returns Promise<number> - Number of records deleted
   */
  async cleanupOldTickers(daysToKeep = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const { error, count } = await supabase
        .from('tickers')
        .delete()
        .lt('created_at', cutoffDate.toISOString());

      if (error) {
        console.error('Error cleaning up old tickers:', error);
        return 0;
      }

      console.log(`🧹 Cleaned up ${count || 0} old ticker records`);
      return count || 0;
    } catch (error) {
      console.error('Exception cleaning up old tickers:', error);
      return 0;
    }
  }
}

// Export singleton instance
export const databaseService = new DatabaseService();