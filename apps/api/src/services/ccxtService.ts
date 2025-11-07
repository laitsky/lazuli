import ccxt from 'ccxt';
import { Ticker, Market } from '../types';

export class CCXTService {
  private spotExchanges: Map<string, any>;
  private perpExchanges: Map<string, any>;

  constructor() {
    this.spotExchanges = new Map();
    this.perpExchanges = new Map();
    this.initializeExchanges();
  }

  private initializeExchanges(): void {
    // Initialize spot exchanges
    this.spotExchanges.set('binance', new ccxt.binance({
      enableRateLimit: true,
      options: {
        defaultType: 'spot',
      },
    }));

    this.spotExchanges.set('bybit', new ccxt.bybit({
      enableRateLimit: true,
      options: {
        defaultType: 'spot',
      },
    }));

    this.spotExchanges.set('okx', new ccxt.okx({
      enableRateLimit: true,
      options: {
        defaultType: 'spot',
      },
    }));

    // Initialize perpetual/swap exchanges
    this.perpExchanges.set('binance', new ccxt.binance({
      enableRateLimit: true,
      options: {
        defaultType: 'future',
      },
    }));

    this.perpExchanges.set('bybit', new ccxt.bybit({
      enableRateLimit: true,
      options: {
        defaultType: 'swap',
      },
    }));

    this.perpExchanges.set('okx', new ccxt.okx({
      enableRateLimit: true,
      options: {
        defaultType: 'swap',
      },
    }));
  }

  private getExchange(exchangeId: string, marketType: 'spot' | 'perp' = 'spot'): any {
    const exchangeMap = marketType === 'spot' ? this.spotExchanges : this.perpExchanges;
    const exchange = exchangeMap.get(exchangeId);
    
    if (!exchange) {
      throw new Error(`Exchange ${exchangeId} not supported for ${marketType} markets`);
    }

    return exchange;
  }

  async loadMarkets(exchangeId: string): Promise<void> {
    const spotExchange = this.getExchange(exchangeId, 'spot');
    const perpExchange = this.getExchange(exchangeId, 'perp');
    
    await Promise.all([
      spotExchange.loadMarkets(),
      perpExchange.loadMarkets(),
    ]);
  }

  async getAllTickers(exchangeId: string): Promise<Ticker[]> {
    try {
      await this.loadMarkets(exchangeId);
      
      const [spotTickers, perpTickers] = await Promise.all([
        this.getTickersByType(exchangeId, 'spot'),
        this.getTickersByType(exchangeId, 'perp'),
      ]);

      return [...spotTickers, ...perpTickers];
    } catch (error) {
      console.error(`Error fetching tickers for ${exchangeId}:`, error);
      throw error;
    }
  }

  private async getTickersByType(exchangeId: string, type: 'spot' | 'perp'): Promise<Ticker[]> {
    try {
      const exchange = this.getExchange(exchangeId, type);
      const tickers = await exchange.fetchTickers();
      
      // Transform exchange-specific ticker format to our standardized format
      return Object.entries(tickers).map(([symbol, ticker]: [string, any]) => ({
        symbol,
        exchange: exchangeId,
        type,
        bid: ticker.bid || null,
        ask: ticker.ask || null,
        last: ticker.last || null,
        high24h: ticker.high || null,
        low24h: ticker.low || null,
        volume24h: ticker.baseVolume || null,
        quoteVolume24h: ticker.quoteVolume || null,
        change24h: ticker.change || null,
        percentage24h: ticker.percentage || null,
        timestamp: ticker.timestamp || Date.now(),
        // Include perpetual-specific data like funding rate and open interest
        fundingRate: type === 'perp' ? (ticker.info?.fundingRate || null) : undefined,
        openInterest: type === 'perp' ? (ticker.info?.openInterest || null) : undefined,
      }));
    } catch (error) {
      console.error(`Error fetching ${type} tickers for ${exchangeId}:`, error);
      return [];
    }
  }

  async getMarkets(exchangeId: string): Promise<Market[]> {
    try {
      await this.loadMarkets(exchangeId);
      
      const [spotMarkets, perpMarkets] = await Promise.all([
        this.getMarketsByType(exchangeId, 'spot'),
        this.getMarketsByType(exchangeId, 'perp'),
      ]);

      return [...spotMarkets, ...perpMarkets];
    } catch (error) {
      console.error(`Error fetching markets for ${exchangeId}:`, error);
      throw error;
    }
  }

  private async getMarketsByType(exchangeId: string, type: 'spot' | 'perp'): Promise<Market[]> {
    try {
      const exchange = this.getExchange(exchangeId, type);
      const markets = exchange.markets;
      
      // Transform exchange market data to our standardized format
      return Object.entries(markets).map(([id, market]: [string, any]) => ({
        id,
        symbol: market.symbol,
        base: market.base,
        quote: market.quote,
        type,
        active: market.active,
        exchange: exchangeId,
      }));
    } catch (error) {
      console.error(`Error fetching ${type} markets for ${exchangeId}:`, error);
      return [];
    }
  }

  async getTicker(exchangeId: string, symbol: string): Promise<Ticker | null> {
    try {
      const allTickers = await this.getAllTickers(exchangeId);
      return allTickers.find(t => t.symbol === symbol) || null;
    } catch (error) {
      console.error(`Error fetching ticker ${symbol} for ${exchangeId}:`, error);
      throw error;
    }
  }
}

// Export singleton instance for use across the application
export const ccxtService = new CCXTService();