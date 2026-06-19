/**
 * CCXT Service (Cloudflare Workers-compatible)
 *
 * CRITICAL: Every exchange constructor MUST receive `fetchImplementation: fetch`.
 * Under `nodejs_compat`, CCXT detects `isNode === true` and uses its bundled
 * node-fetch, which does NOT auto-decompress gzip responses (Binance serves
 * gzip). Injecting the Workers native `fetch` makes decompression work.
 *
 * `protobufjs` is installed as a sibling dependency because CCXT's bundle
 * references it without declaring it as a dependency.
 */

import ccxt from 'ccxt';
import { Ticker, Market, OHLCV, Timeframe } from '../types';
import { OrderBook, OrderBookEntry } from '@lazuli/shared';
import { convertFromCCXTNotation, convertToCCXTNotation } from '../utils/validation';
import {
  ExchangeError,
  ValidationError,
  exchangeNotSupported,
  invalidTimeframe,
  classifyCcxtError,
} from '../errors';
import { createServiceLogger } from '../utils/logger';

// Create logger for CCXT service
const log = createServiceLogger('ccxt');

// CCXT's TypeScript typings don't expose every subclass (e.g. binanceusdm) on
// the default export, so we cast to a record for dynamic access.
const dynamicCcxt = ccxt as typeof ccxt & Record<string, any>;

/**
 * Shared options applied to every exchange constructor.
 * `fetchImplementation` is the Workers workaround described above.
 */
function baseOptions(): Record<string, unknown> {
  return {
    enableRateLimit: true,
    fetchImplementation: fetch,
  };
}

export class CCXTService {
  private spotExchanges: Map<string, any>;
  private perpExchanges: Map<string, any>;

  constructor() {
    this.spotExchanges = new Map();
    this.perpExchanges = new Map();
    this.initializeExchanges();
  }

  private initializeExchanges(): void {
    // --- Spot exchanges ---
    this.spotExchanges.set(
      'binance',
      new ccxt.binance({
        ...baseOptions(),
        options: { defaultType: 'spot' },
      })
    );

    this.spotExchanges.set(
      'bybit',
      new ccxt.bybit({
        ...baseOptions(),
        options: { defaultType: 'spot' },
      })
    );

    this.spotExchanges.set(
      'okx',
      new ccxt.okx({
        ...baseOptions(),
        options: { defaultType: 'spot' },
      })
    );

    // --- Perpetual / swap exchanges ---
    // Binance USDT-M futures (binanceusdm is the dedicated class)
    const BinanceUsdm = dynamicCcxt.binanceusdm || ccxt.binance;
    this.perpExchanges.set(
      'binance',
      new BinanceUsdm({
        ...baseOptions(),
        options: { defaultType: 'future' },
      })
    );

    this.perpExchanges.set(
      'bybit',
      new ccxt.bybit({
        ...baseOptions(),
        options: { defaultType: 'swap' },
      })
    );

    this.perpExchanges.set(
      'okx',
      new ccxt.okx({
        ...baseOptions(),
        options: { defaultType: 'swap' },
      })
    );

    // Hyperliquid (perpetual only - no spot markets)
    this.perpExchanges.set(
      'hyperliquid',
      new ccxt.hyperliquid({
        ...baseOptions(),
        options: { defaultType: 'swap' },
      })
    );

    // Upbit (spot only - no perpetual markets)
    const UpbitExchange = dynamicCcxt.upbit;
    if (UpbitExchange) {
      this.spotExchanges.set(
        'upbit',
        new UpbitExchange({
          ...baseOptions(),
          options: { defaultType: 'spot' },
        })
      );
    } else {
      log.warn('Upbit exchange class not available; skipping initialization');
    }
  }

  private getExchange(exchangeId: string, marketType: 'spot' | 'perp' = 'spot'): any {
    const exchangeMap = marketType === 'spot' ? this.spotExchanges : this.perpExchanges;
    const exchange = exchangeMap.get(exchangeId);

    if (!exchange) {
      throw exchangeNotSupported(exchangeId);
    }

    return exchange;
  }

  /**
   * Check if an exchange has spot markets
   */
  hasSpotMarkets(exchangeId: string): boolean {
    return this.spotExchanges.has(exchangeId);
  }

  /**
   * Check if an exchange has perpetual markets
   */
  hasPerpMarkets(exchangeId: string): boolean {
    return this.perpExchanges.has(exchangeId);
  }

  /**
   * Get list of all supported exchange IDs
   */
  getSupportedExchanges(): string[] {
    const exchanges = new Set([...this.spotExchanges.keys(), ...this.perpExchanges.keys()]);
    return Array.from(exchanges);
  }

  /**
   * Pre-warm exchange markets on startup.
   * Loads markets for all supported exchanges in parallel.
   */
  async warmup(): Promise<void> {
    log.info('Warming up exchange markets...');
    const startTime = Date.now();
    const exchanges = this.getSupportedExchanges();

    const results = await Promise.allSettled(
      exchanges.map(async (exchangeId) => {
        try {
          await this.loadMarkets(exchangeId);
          log.debug('Markets loaded', { exchange: exchangeId });
          return { exchangeId, success: true };
        } catch (error) {
          log.error(`Failed to load ${exchangeId} markets`, error, { exchange: exchangeId });
          return { exchangeId, success: false, error };
        }
      })
    );

    const duration = Date.now() - startTime;
    const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;

    log.info('Warmup complete', {
      successful,
      total: exchanges.length,
      duration: `${duration}ms`,
    });
  }

  async loadMarkets(exchangeId: string): Promise<void> {
    const loadPromises: Promise<any>[] = [];

    if (this.hasSpotMarkets(exchangeId)) {
      const spotExchange = this.getExchange(exchangeId, 'spot');
      loadPromises.push(spotExchange.loadMarkets());
    }

    if (this.hasPerpMarkets(exchangeId)) {
      const perpExchange = this.getExchange(exchangeId, 'perp');
      loadPromises.push(perpExchange.loadMarkets());
    }

    await Promise.all(loadPromises);
  }

  async getAllTickers(exchangeId: string): Promise<Ticker[]> {
    try {
      await this.loadMarkets(exchangeId);

      const tickerPromises: Promise<Ticker[]>[] = [];

      if (this.hasSpotMarkets(exchangeId)) {
        tickerPromises.push(this.getTickersByType(exchangeId, 'spot'));
      }

      if (this.hasPerpMarkets(exchangeId)) {
        tickerPromises.push(this.getTickersByType(exchangeId, 'perp'));
      }

      const tickerArrays = await Promise.all(tickerPromises);
      return tickerArrays.flat();
    } catch (error) {
      if (error instanceof ExchangeError) {
        throw error;
      }
      throw classifyCcxtError(error, exchangeId);
    }
  }

  private async getTickersByType(exchangeId: string, type: 'spot' | 'perp'): Promise<Ticker[]> {
    try {
      const exchange = this.getExchange(exchangeId, type);
      const tickers = await exchange.fetchTickers();

      return Object.entries(tickers).map(([ccxtSymbol, ticker]: [string, any]) => {
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
          fundingRate: type === 'perp' ? ticker.info?.fundingRate || null : undefined,
          openInterest: type === 'perp' ? ticker.info?.openInterest || null : undefined,
        };
      });
    } catch (error) {
      log.error(`Error fetching ${type} tickers`, error, { exchange: exchangeId, type });
      if (error instanceof ExchangeError) {
        throw error;
      }
      throw classifyCcxtError(error, exchangeId);
    }
  }

  async getMarkets(exchangeId: string): Promise<Market[]> {
    try {
      await this.loadMarkets(exchangeId);

      const marketPromises: Promise<Market[]>[] = [];

      if (this.hasSpotMarkets(exchangeId)) {
        marketPromises.push(this.getMarketsByType(exchangeId, 'spot'));
      }

      if (this.hasPerpMarkets(exchangeId)) {
        marketPromises.push(this.getMarketsByType(exchangeId, 'perp'));
      }

      const marketArrays = await Promise.all(marketPromises);
      return marketArrays.flat();
    } catch (error) {
      if (error instanceof ExchangeError) {
        throw error;
      }
      throw classifyCcxtError(error, exchangeId);
    }
  }

  private async getMarketsByType(exchangeId: string, type: 'spot' | 'perp'): Promise<Market[]> {
    try {
      const exchange = this.getExchange(exchangeId, type);
      const markets = exchange.markets;

      return Object.entries(markets).map(([id, market]: [string, any]) => {
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
      log.error(`Error fetching ${type} markets`, error, { exchange: exchangeId, type });
      if (error instanceof ExchangeError) {
        throw error;
      }
      throw classifyCcxtError(error, exchangeId);
    }
  }

  async getTicker(exchangeId: string, symbol: string): Promise<Ticker | null> {
    try {
      const allTickers = await this.getAllTickers(exchangeId);
      const ticker = allTickers.find((t) => t.symbol === symbol);
      if (!ticker) {
        return null;
      }
      return ticker;
    } catch (error) {
      if (error instanceof ExchangeError) {
        throw error;
      }
      throw classifyCcxtError(error, exchangeId);
    }
  }

  /**
   * Check if a timeframe is supported by a specific exchange
   */
  isTimeframeSupported(
    exchangeId: string,
    timeframe: Timeframe,
    marketType: 'spot' | 'perp' = 'spot'
  ): boolean {
    try {
      const exchange = this.getExchange(exchangeId, marketType);
      if (!exchange.timeframes) {
        return true;
      }
      return timeframe in exchange.timeframes;
    } catch (error) {
      log.error('Error checking timeframe support', error, { exchange: exchangeId, timeframe });
      return false;
    }
  }

  /**
   * Get list of supported timeframes for an exchange
   */
  getSupportedTimeframes(exchangeId: string, marketType: 'spot' | 'perp' = 'spot'): string[] {
    try {
      const exchange = this.getExchange(exchangeId, marketType);
      if (!exchange.timeframes) {
        return ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
      }
      return Object.keys(exchange.timeframes);
    } catch (error) {
      log.error('Error getting supported timeframes', error, { exchange: exchangeId });
      return [];
    }
  }

  /**
   * Fetch OHLCV (candlestick) data for a specific symbol and timeframe
   */
  async fetchOHLCV(
    exchangeId: string,
    symbol: string,
    timeframe: Timeframe,
    marketType: 'spot' | 'perp' = 'spot',
    limit: number = 100
  ): Promise<OHLCV[]> {
    try {
      const ccxtSymbol = convertToCCXTNotation(symbol, marketType);
      const exchange = this.getExchange(exchangeId, marketType);

      if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
        await exchange.loadMarkets();
      }

      if (!this.isTimeframeSupported(exchangeId, timeframe, marketType)) {
        const supported = this.getSupportedTimeframes(exchangeId, marketType);
        throw invalidTimeframe(timeframe, supported);
      }

      const ohlcvData = await exchange.fetchOHLCV(ccxtSymbol, timeframe, undefined, limit);

      return ohlcvData.map((candle: number[]) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
      }));
    } catch (error) {
      log.error('Error fetching OHLCV', error, { exchange: exchangeId, symbol, timeframe });
      if (error instanceof ExchangeError || error instanceof ValidationError) {
        throw error;
      }
      throw classifyCcxtError(error, exchangeId);
    }
  }

  /**
   * Fetch order book (depth) data for a specific symbol
   */
  async fetchOrderBook(
    exchangeId: string,
    symbol: string,
    marketType: 'spot' | 'perp' = 'spot',
    limit: number = 50
  ): Promise<OrderBook> {
    try {
      const ccxtSymbol = convertToCCXTNotation(symbol, marketType);
      const exchange = this.getExchange(exchangeId, marketType);

      if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
        await exchange.loadMarkets();
      }

      const orderBookData = await exchange.fetchOrderBook(ccxtSymbol, limit);

      let bidCumulative = 0;
      const bids: OrderBookEntry[] = orderBookData.bids.map((entry: [number, number]) => {
        bidCumulative += entry[1];
        return {
          price: entry[0],
          amount: entry[1],
          total: bidCumulative,
        };
      });

      let askCumulative = 0;
      const asks: OrderBookEntry[] = orderBookData.asks.map((entry: [number, number]) => {
        askCumulative += entry[1];
        return {
          price: entry[0],
          amount: entry[1],
          total: askCumulative,
        };
      });

      return {
        symbol,
        exchange: exchangeId,
        type: marketType,
        bids,
        asks,
        timestamp: orderBookData.timestamp || Date.now(),
        nonce: orderBookData.nonce,
      };
    } catch (error) {
      log.error('Error fetching order book', error, { exchange: exchangeId, symbol, marketType });
      if (error instanceof ExchangeError || error instanceof ValidationError) {
        throw error;
      }
      throw classifyCcxtError(error, exchangeId);
    }
  }
}

// Export singleton instance for use across the application
export const ccxtService = new CCXTService();
