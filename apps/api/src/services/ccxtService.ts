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
import { FundingRateData, OrderBook, OrderBookEntry } from '@lazuli/shared';
import { convertFromCCXTNotation, convertToCCXTNotation, parseSymbol } from '../utils/validation';
import {
  ErrorCode,
  ExchangeError,
  ValidationError,
  exchangeNotSupported,
  exchangeUnavailable,
  invalidTimeframe,
  classifyCcxtError,
} from '../errors';
import { createServiceLogger } from '../utils/logger';

// Create logger for CCXT service
const log = createServiceLogger('ccxt');
const EXCHANGE_TIMEOUT_MS = 12_000;
const MAX_TRANSIENT_ATTEMPTS = 3;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

interface CircuitState {
  failures: number;
  openUntil: number;
}

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
    timeout: EXCHANGE_TIMEOUT_MS,
  };
}

export class CCXTService {
  private spotExchanges: Map<string, any>;
  private perpExchanges: Map<string, any>;
  private circuits = new Map<string, CircuitState>();
  private inFlight = new Map<string, Promise<unknown>>();

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
      loadPromises.push(
        this.withExchangeOperation(exchangeId, 'markets:spot', () => spotExchange.loadMarkets())
      );
    }

    if (this.hasPerpMarkets(exchangeId)) {
      const perpExchange = this.getExchange(exchangeId, 'perp');
      loadPromises.push(
        this.withExchangeOperation(exchangeId, 'markets:perp', () => perpExchange.loadMarkets())
      );
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
      const tickers = await this.withExchangeOperation<Record<string, any>>(
        exchangeId,
        `tickers:${type}`,
        () => exchange.fetchTickers()
      );

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
    limit: number = 100,
    since?: number
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

      const ohlcvData = await this.withExchangeOperation<number[][]>(
        exchangeId,
        `ohlcv:${marketType}:${timeframe}:${ccxtSymbol}:${since ?? 'latest'}:${limit}`,
        `ohlcv:${marketType}:${timeframe}`,
        () => exchange.fetchOHLCV(ccxtSymbol, timeframe, since, limit)
      );

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
   * Fetch one archive page without the public-path retry/circuit wrapper.
   * BackfillCoordinatorDO owns pacing and retries so provider bursts are not
   * multiplied by nested retry loops.
   */
  async fetchOHLCVBackfillPage(
    exchangeId: string,
    symbol: string,
    timeframe: Timeframe,
    marketType: 'spot' | 'perp',
    limit: number,
    since: number
  ): Promise<OHLCV[]> {
    try {
      const exchange = this.getExchange(exchangeId, marketType);
      if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
        await exchange.loadMarkets();
      }
      if (!this.isTimeframeSupported(exchangeId, timeframe, marketType)) {
        throw invalidTimeframe(timeframe, this.getSupportedTimeframes(exchangeId, marketType));
      }
      const rows = (await exchange.fetchOHLCV(
        convertToCCXTNotation(symbol, marketType),
        timeframe,
        since,
        limit
      )) as number[][];
      return rows.map((candle) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
      }));
    } catch (error) {
      if (error instanceof ExchangeError || error instanceof ValidationError) throw error;
      throw classifyCcxtError(error, exchangeId);
    }
  }

  /** Single-attempt historical funding page; the Durable Object owns retries. */
  async fetchFundingHistoryBackfillPage(
    exchangeId: string,
    symbol: string,
    since: number,
    limit: number
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const exchange = this.getExchange(exchangeId, 'perp');
      if (!exchange.markets || Object.keys(exchange.markets).length === 0)
        await exchange.loadMarkets();
      if (!exchange.has.fetchFundingRateHistory) {
        throw new ValidationError(
          ErrorCode.EXCHANGE_NOT_SUPPORTED,
          `Exchange '${exchangeId}' does not support funding history`
        );
      }
      const rows = await exchange.fetchFundingRateHistory(
        convertToCCXTNotation(symbol, 'perp'),
        since,
        limit
      );
      return rows.map((row: any) => ({
        t: row.timestamp ?? null,
        rate: row.fundingRate ?? null,
        markPrice: row.markPrice ?? null,
        indexPrice: row.indexPrice ?? null,
        nextFundingAt: row.nextFundingTimestamp ?? null,
      }));
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw classifyCcxtError(error, exchangeId);
    }
  }

  /** Single-attempt historical OI page; native units are retained with USD when available. */
  async fetchOpenInterestHistoryBackfillPage(
    exchangeId: string,
    symbol: string,
    resolution: string,
    since: number,
    limit: number
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const exchange = this.getExchange(exchangeId, 'perp');
      if (!exchange.markets || Object.keys(exchange.markets).length === 0)
        await exchange.loadMarkets();
      if (!exchange.has.fetchOpenInterestHistory) {
        throw new ValidationError(
          ErrorCode.EXCHANGE_NOT_SUPPORTED,
          `Exchange '${exchangeId}' does not support open-interest history`
        );
      }
      const rows = await exchange.fetchOpenInterestHistory(
        convertToCCXTNotation(symbol, 'perp'),
        resolution,
        since,
        limit
      );
      return rows.map((row: any) => ({
        t: row.timestamp ?? null,
        openInterest: row.openInterestAmount ?? row.openInterestValue ?? null,
        openInterestUsd: row.openInterestValue ?? null,
        nativeUnit: row.openInterestValue !== undefined ? 'quote' : 'contracts',
      }));
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw classifyCcxtError(error, exchangeId);
    }
  }

  async fetchTradesBackfillPage(
    exchangeId: string,
    symbol: string,
    marketType: 'spot' | 'perp',
    since: number,
    limit: number
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const exchange = this.getExchange(exchangeId, marketType);
      if (!exchange.markets || Object.keys(exchange.markets).length === 0)
        await exchange.loadMarkets();
      const rows = await exchange.fetchTrades(
        convertToCCXTNotation(symbol, marketType),
        since,
        limit
      );
      return rows.map((row: any) => ({
        t: row.timestamp ?? null,
        id: row.id ?? null,
        price: row.price ?? null,
        amount: row.amount ?? null,
        cost: row.cost ?? null,
        side: row.side ?? null,
      }));
    } catch (error) {
      throw classifyCcxtError(error, exchangeId);
    }
  }

  historicalCapabilities(exchangeId: string): Record<string, boolean> {
    const exchange = this.getExchange(exchangeId, 'perp');
    return {
      fundingRate: exchange.has.fetchFundingRateHistory === true,
      openInterest: exchange.has.fetchOpenInterestHistory === true,
      trades: exchange.has.fetchTrades === true,
      // CCXT capability flags alone do not establish stable historical pagination
      // semantics. Keep this disabled until an exchange-native adapter is verified.
      liquidations: false,
    };
  }

  /** Single-attempt catalog snapshot used only by the history coordinator. */
  async fetchMarketCatalogBackfill(
    exchangeId: string,
    pace?: () => Promise<void>
  ): Promise<Array<Market & { quoteVolume24h: number | null; volumeRank: number | null }>> {
    try {
      const rows: Array<Market & { quoteVolume24h: number | null; volumeRank: number | null }> = [];
      for (const type of ['spot', 'perp'] as const) {
        if (type === 'spot' ? !this.hasSpotMarkets(exchangeId) : !this.hasPerpMarkets(exchangeId))
          continue;
        const exchange = this.getExchange(exchangeId, type);
        if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
          await pace?.();
          await exchange.loadMarkets();
        }
        let tickers: Record<string, any> = {};
        if (exchange.has.fetchTickers === true) {
          await pace?.();
          tickers = await exchange.fetchTickers();
        }
        const typed = Object.entries(exchange.markets).flatMap(([id, value]) => {
          const market = value as any;
          if (market.active === false) return [];
          const ticker = tickers[market.symbol] ?? {};
          return [
            {
              id,
              symbol: convertFromCCXTNotation(market.symbol, type),
              base: market.base,
              quote: market.quote,
              type,
              active: true,
              exchange: exchangeId,
              quoteVolume24h:
                typeof ticker.quoteVolume === 'number' && Number.isFinite(ticker.quoteVolume)
                  ? ticker.quoteVolume
                  : null,
              volumeRank: null,
            },
          ];
        });
        typed.sort((a, b) => Number(b.quoteVolume24h ?? 0) - Number(a.quoteVolume24h ?? 0));
        rows.push(...typed.map((row, index) => ({ ...row, volumeRank: index + 1 })));
      }
      return rows;
    } catch (error) {
      if (error instanceof ExchangeError) throw error;
      throw classifyCcxtError(error, exchangeId);
    }
  }

  getExchangeRateLimitMs(exchangeId: string, marketType: 'spot' | 'perp' = 'spot'): number {
    const configured = Number(this.getExchange(exchangeId, marketType).rateLimit);
    return Number.isFinite(configured) && configured > 0 ? configured : 1_000;
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

      const orderBookData = await this.withExchangeOperation<{
        bids: Array<[number, number]>;
        asks: Array<[number, number]>;
        timestamp?: number;
        nonce?: number;
      }>(
        exchangeId,
        `orderbook:${marketType}:${ccxtSymbol}:${limit}`,
        `orderbook:${marketType}`,
        () => exchange.fetchOrderBook(ccxtSymbol, limit)
      );

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

  /**
   * Fetch funding rates for all perpetual markets supported by an exchange.
   * CCXT returns either an array or an object keyed by symbol depending on the
   * exchange, so this method normalizes both shapes into Lazuli's public type.
   */
  async getFundingRates(exchangeId: string): Promise<FundingRateData[]> {
    try {
      const exchange = this.getExchange(exchangeId, 'perp');

      if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
        await exchange.loadMarkets();
      }

      const rawRates = await this.withExchangeOperation<any[] | Record<string, any>>(
        exchangeId,
        'funding:perp',
        () =>
          typeof exchange.fetchFundingRates === 'function'
            ? exchange.fetchFundingRates()
            : Promise.all(
                Object.keys(exchange.markets)
                  .slice(0, 200)
                  .map((symbol) => exchange.fetchFundingRate(symbol))
              )
      );

      const rates = Array.isArray(rawRates) ? rawRates : Object.values(rawRates);

      return rates.map((rate: any) => {
        const symbol = convertFromCCXTNotation(rate.symbol, 'perp');
        const { base } = parseSymbol(symbol);
        const fundingRate = Number(rate.fundingRate ?? rate.rate ?? 0);
        const fundingRatePercent = fundingRate * 100;

        return {
          symbol,
          baseAsset: base,
          exchange: exchangeId,
          fundingRate,
          fundingRatePercent,
          annualizedRate: fundingRatePercent * 3 * 365,
          nextFundingTime:
            typeof rate.nextFundingTimestamp === 'number'
              ? rate.nextFundingTimestamp
              : typeof rate.fundingTimestamp === 'number'
                ? rate.fundingTimestamp
                : null,
          markPrice: rate.markPrice ?? null,
          indexPrice: rate.indexPrice ?? null,
          openInterest: rate.openInterest ?? null,
          volume24h: rate.info?.volume24h ? Number(rate.info.volume24h) : null,
          timestamp: rate.timestamp ?? Date.now(),
        };
      });
    } catch (error) {
      log.error('Error fetching funding rates', error, { exchange: exchangeId });
      if (error instanceof ExchangeError || error instanceof ValidationError) {
        throw error;
      }
      throw classifyCcxtError(error, exchangeId);
    }
  }

  private async withExchangeOperation<T>(
    exchangeId: string,
    resource: string,
    circuitResourceOrOperation: string | (() => Promise<T>),
    maybeOperation?: () => Promise<T>
  ): Promise<T> {
    const circuitResource =
      typeof circuitResourceOrOperation === 'string' ? circuitResourceOrOperation : resource;
    const operation =
      typeof circuitResourceOrOperation === 'function'
        ? circuitResourceOrOperation
        : maybeOperation;
    if (!operation) {
      throw new Error(`Missing exchange operation for ${resource}`);
    }

    const circuitKey = `${exchangeId}:${circuitResource}`;
    const inFlightKey = `${exchangeId}:${resource}`;
    const circuit = this.circuits.get(circuitKey);
    if (circuit && circuit.openUntil > Date.now()) {
      throw exchangeUnavailable(exchangeId, `circuit open for ${circuitResource}`);
    }

    const existing = this.inFlight.get(inFlightKey);
    if (existing) {
      return existing as Promise<T>;
    }

    const task = this.runWithRetries(exchangeId, circuitResource, operation).finally(() => {
      this.inFlight.delete(inFlightKey);
    });
    this.inFlight.set(inFlightKey, task);
    return task;
  }

  private async runWithRetries<T>(
    exchangeId: string,
    resource: string,
    operation: () => Promise<T>
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.withTimeout(operation(), EXCHANGE_TIMEOUT_MS, resource);
        this.circuits.delete(`${exchangeId}:${resource}`);
        return result;
      } catch (error) {
        lastError = error;
        if (!isTransientExchangeError(error) || attempt === MAX_TRANSIENT_ATTEMPTS) {
          break;
        }
        await sleep(jitterDelay(attempt));
      }
    }

    if (isTransientExchangeError(lastError)) {
      this.recordCircuitFailure(exchangeId, resource);
    }
    throw lastError;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    resource: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Request timeout after ${timeoutMs}ms for ${resource}`)),
        timeoutMs
      );
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private recordCircuitFailure(exchangeId: string, resource: string): void {
    const key = `${exchangeId}:${resource}`;
    const previous = this.circuits.get(key) ?? { failures: 0, openUntil: 0 };
    const failures = previous.failures + 1;
    this.circuits.set(key, {
      failures,
      openUntil:
        failures >= CIRCUIT_FAILURE_THRESHOLD
          ? Date.now() + CIRCUIT_COOLDOWN_MS
          : previous.openUntil,
    });
  }
}

// Export singleton instance for use across the application
export const ccxtService = new CCXTService();

export function isTransientExchangeError(error: unknown): boolean {
  if (error instanceof ValidationError) {
    return false;
  }
  if (error instanceof ExchangeError) {
    return (
      error.code === ErrorCode.EXCHANGE_TIMEOUT ||
      error.code === ErrorCode.EXCHANGE_RATE_LIMIT ||
      error.code === ErrorCode.EXCHANGE_UNAVAILABLE ||
      error.code === ErrorCode.EXCHANGE_NETWORK_ERROR
    );
  }

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504')
  );
}

function jitterDelay(attempt: number): number {
  return Math.min(2_000, 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
