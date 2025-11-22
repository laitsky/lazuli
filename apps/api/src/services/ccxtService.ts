import ccxt from 'ccxt';
import { Ticker, Market, OHLCV, Timeframe } from '../types';
import { convertFromCCXTNotation, convertToCCXTNotation } from '../utils/validation';

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
    this.spotExchanges.set(
      'binance',
      new ccxt.binance({
        enableRateLimit: true,
        options: {
          defaultType: 'spot',
        },
      })
    );

    this.spotExchanges.set(
      'bybit',
      new ccxt.bybit({
        enableRateLimit: true,
        options: {
          defaultType: 'spot',
        },
      })
    );

    this.spotExchanges.set(
      'okx',
      new ccxt.okx({
        enableRateLimit: true,
        options: {
          defaultType: 'spot',
        },
      })
    );

    // Initialize perpetual/swap exchanges
    this.perpExchanges.set(
      'binance',
      new ccxt.binance({
        enableRateLimit: true,
        options: {
          defaultType: 'future',
        },
      })
    );

    this.perpExchanges.set(
      'bybit',
      new ccxt.bybit({
        enableRateLimit: true,
        options: {
          defaultType: 'swap',
        },
      })
    );

    this.perpExchanges.set(
      'okx',
      new ccxt.okx({
        enableRateLimit: true,
        options: {
          defaultType: 'swap',
        },
      })
    );
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

    await Promise.all([spotExchange.loadMarkets(), perpExchange.loadMarkets()]);
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
      return Object.entries(tickers).map(([ccxtSymbol, ticker]: [string, any]) => {
        // Convert CCXT symbol notation to our standardized notation
        // Spot: BTC/USDT -> BTC-USDT
        // Perp: BTC/USDT:USDT -> BTCUSDT.P
        const standardSymbol = convertFromCCXTNotation(ccxtSymbol, type);

        return {
          symbol: standardSymbol,
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
          fundingRate: type === 'perp' ? ticker.info?.fundingRate || null : undefined,
          openInterest: type === 'perp' ? ticker.info?.openInterest || null : undefined,
        };
      });
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
      return Object.entries(markets).map(([id, market]: [string, any]) => {
        // Convert CCXT symbol notation to our standardized notation
        const standardSymbol = convertFromCCXTNotation(market.symbol, type);

        return {
          id,
          symbol: standardSymbol,
          base: market.base,
          quote: market.quote,
          type,
          active: market.active,
          exchange: exchangeId,
        };
      });
    } catch (error) {
      console.error(`Error fetching ${type} markets for ${exchangeId}:`, error);
      return [];
    }
  }

  async getTicker(exchangeId: string, symbol: string): Promise<Ticker | null> {
    try {
      const allTickers = await this.getAllTickers(exchangeId);
      return allTickers.find((t) => t.symbol === symbol) || null;
    } catch (error) {
      console.error(`Error fetching ticker ${symbol} for ${exchangeId}:`, error);
      throw error;
    }
  }

  /**
   * Check if a timeframe is supported by a specific exchange
   * Different exchanges support different timeframes
   * @param exchangeId - Exchange identifier
   * @param timeframe - Timeframe to check
   * @param marketType - Market type (spot or perp)
   * @returns true if supported, false otherwise
   */
  isTimeframeSupported(
    exchangeId: string,
    timeframe: Timeframe,
    marketType: 'spot' | 'perp' = 'spot'
  ): boolean {
    try {
      const exchange = this.getExchange(exchangeId, marketType);

      // CCXT exchanges have a timeframes property that lists supported timeframes
      if (!exchange.timeframes) {
        // If timeframes not available, assume all are supported
        return true;
      }

      // Check if the timeframe exists in the exchange's supported timeframes
      return timeframe in exchange.timeframes;
    } catch (error) {
      console.error(`Error checking timeframe support for ${exchangeId}:`, error);
      return false;
    }
  }

  /**
   * Get list of supported timeframes for an exchange
   * @param exchangeId - Exchange identifier
   * @param marketType - Market type (spot or perp)
   * @returns Array of supported timeframes
   */
  getSupportedTimeframes(exchangeId: string, marketType: 'spot' | 'perp' = 'spot'): string[] {
    try {
      const exchange = this.getExchange(exchangeId, marketType);

      if (!exchange.timeframes) {
        // Return default set if not available
        return ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
      }

      return Object.keys(exchange.timeframes);
    } catch (error) {
      console.error(`Error getting supported timeframes for ${exchangeId}:`, error);
      return [];
    }
  }

  /**
   * Fetch OHLCV (candlestick) data for a specific symbol and timeframe
   * @param exchangeId - Exchange identifier (binance, bybit, okx)
   * @param symbol - Trading pair symbol in standardized notation (e.g., 'BTC-USDT' or 'BTCUSDT.P')
   * @param timeframe - Timeframe for candles (1m, 5m, 15m, 1h, 4h, 1d, 3d, 1w)
   * @param marketType - Market type (spot or perp)
   * @param limit - Number of candles to fetch (default: 100)
   * @returns Array of OHLCV candles
   */
  async fetchOHLCV(
    exchangeId: string,
    symbol: string,
    timeframe: Timeframe,
    marketType: 'spot' | 'perp' = 'spot',
    limit: number = 100
  ): Promise<OHLCV[]> {
    try {
      // Convert our standardized symbol notation to CCXT format
      // BTC-USDT -> BTC/USDT (spot)
      // BTCUSDT.P -> BTC/USDT:USDT (perp)
      const ccxtSymbol = convertToCCXTNotation(symbol, marketType);

      // Get the appropriate exchange instance
      const exchange = this.getExchange(exchangeId, marketType);

      // Load markets if not already loaded
      if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
        await exchange.loadMarkets();
      }

      // Check if timeframe is supported by this exchange
      if (!this.isTimeframeSupported(exchangeId, timeframe, marketType)) {
        const supported = this.getSupportedTimeframes(exchangeId, marketType);
        throw new Error(
          `Timeframe ${timeframe} is not supported by ${exchangeId}. ` +
            `Supported timeframes: ${supported.join(', ')}`
        );
      }

      // Fetch OHLCV data from the exchange using CCXT symbol format
      // CCXT returns array of [timestamp, open, high, low, close, volume]
      const ohlcvData = await exchange.fetchOHLCV(ccxtSymbol, timeframe, undefined, limit);

      // Transform CCXT format to our standardized OHLCV format
      return ohlcvData.map((candle: number[]) => ({
        timestamp: candle[0], // Timestamp in milliseconds
        open: candle[1], // Opening price
        high: candle[2], // Highest price
        low: candle[3], // Lowest price
        close: candle[4], // Closing price
        volume: candle[5], // Volume in base currency
      }));
    } catch (error) {
      console.error(`Error fetching OHLCV for ${symbol} on ${exchangeId}:`, error);
      throw error;
    }
  }
}

// Export singleton instance for use across the application
export const ccxtService = new CCXTService();
