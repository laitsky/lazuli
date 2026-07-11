/**
 * API Client for Lazuli Backend
 * Handles all communication with the backend REST API
 */

import {
  ApiResponse,
  ExchangeInfo,
  Ticker,
  TickersResponse,
  MarketsResponse,
  HealthResponse,
  SupportedExchange,
  OHLCVResponse,
  CustomPairResponse,
  CustomIndexResponse,
  IndexAsset,
  Timeframe,
  AltScreenerResponse,
  BaseCurrency,
  PerformancePeriod,
  ScreenerSortBy,
  FundingRateResponse,
  EtfFlowResponse,
  EtfFundsResponse,
  InstitutionalAsset,
  InstitutionalConfluenceResponse,
  InstitutionalOverviewResponse,
  InstitutionalRange,
  OptionsChainResponse,
  OptionsExpiriesResponse,
  OptionsVolatilityResponse,
  CrossExchangeFundingResponse,
  TechnicalIndicatorResponse,
  OrderBookResponse,
  PriceArbitrageResponse,
  OHLCV,
  LiquidationRadarResponse,
  OrderFlowResponse,
  FundingRadarResponse,
  FundingArbitrageResponse,
  BacktestResponse,
  StrategyDefinition,
  TrendingVolumeResponse,
  AlphaFeedItem,
  AlphaFeedResponse,
  AuthMagicLinkResponse,
  AuthSessionResponse,
  PasskeyAuthenticationOptionsResponse,
  PasskeyRecord,
  PasskeyRegistrationOptionsResponse,
} from '@lazuli/shared';

// API base URL - defaults to same-origin for Cloudflare Workers Static Assets.
// Vite exposes environment variables via import.meta.env with VITE_ prefix
// Local Vite development proxies /api to the API Worker in vite.config.ts.
const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const API_VERSION = '/api/v1';

// Default timeout for API requests (30 seconds)
const DEFAULT_TIMEOUT = 30000;
type QueryParams = object;

export interface MultiTimeframeOHLCVResponse {
  exchange: string;
  symbol: string;
  type: 'spot' | 'perp';
  timeframes: Timeframe[];
  candles: Record<string, OHLCV[]>;
  timestamp: number;
}

/**
 * Query parameters for tickers endpoint
 */
export interface TickersQueryParams {
  page?: number;
  limit?: number;
  type?: 'spot' | 'perp';
  quote?: string; // Filter by quote currency (e.g., 'USDT', 'BTC')
  search?: string;
  sortBy?: 'volume' | 'price' | 'change';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Query parameters for markets endpoint
 */
export interface MarketsQueryParams {
  page?: number;
  limit?: number;
  type?: 'spot' | 'perp';
  search?: string;
  active?: boolean;
}

/**
 * Query parameters for OHLCV endpoint
 */
export interface OHLCVQueryParams {
  timeframe: Timeframe;
  type?: 'spot' | 'perp';
  limit?: number;
}

/**
 * Query parameters for multi-timeframe OHLCV endpoint
 */
export interface MultiTimeframeOHLCVQueryParams {
  timeframes: Timeframe[];
  type?: 'spot' | 'perp';
  limit?: number;
}

/**
 * Query parameters for synthetic pair endpoint
 */
export interface CustomPairQueryParams {
  timeframe: Timeframe;
  type?: 'spot' | 'perp';
  limit?: number;
}

/**
 * Request parameters for custom index calculation
 */
export interface CustomIndexRequest {
  name: string;
  exchange: SupportedExchange;
  timeframe: Timeframe;
  assets: IndexAsset[];
  limit?: number;
}

/**
 * Query parameters for SuperEMA endpoint
 */
export interface SuperEMAQueryParams {
  timeframe: Timeframe;
  type?: 'spot' | 'perp';
  limit?: number;
  maxPeriod?: number;
}

/**
 * Query parameters for Alt Screener endpoint
 */
export interface AltScreenerQueryParams {
  base?: BaseCurrency; // Comparison base currency (USD, BTC, ETH, SOL)
  period?: PerformancePeriod; // Performance period (1h, 4h, 24h, 7d, 30d)
  sortBy?: ScreenerSortBy; // Sort field (performance, volume, price, name)
  sortOrder?: 'asc' | 'desc'; // Sort direction
  limit?: number; // Maximum number of results
  minVolume?: number; // Minimum 24h volume filter
  maxVolume?: number; // Maximum 24h volume filter
  minChange?: number; // Minimum percentage change filter
  maxChange?: number; // Maximum percentage change filter
  minRsi?: number; // Minimum RSI(14) filter
  maxRsi?: number; // Maximum RSI(14) filter
  breakout?: 'up' | 'down' | 'any'; // 24h breakout filter
  minFundingRate?: number; // Minimum funding rate percent
  maxFundingRate?: number; // Maximum funding rate percent
  minOpenInterest?: number; // Minimum open interest in USD
  type?: 'spot' | 'perp'; // Market type filter
  search?: string; // Symbol search query
}

/**
 * Query parameters for Funding Rate endpoint
 */
export interface FundingRateQueryParams {
  sortBy?: 'rate' | 'volume' | 'openInterest'; // Sort field
  sortOrder?: 'asc' | 'desc'; // Sort direction
  limit?: number; // Maximum number of results (default: 100, max: 500)
}

/**
 * Query parameters for Cross-Exchange Funding endpoint
 */
export interface CrossExchangeFundingQueryParams {
  limit?: number; // Maximum assets to compare (default: 50, max: 200)
}

/**
 * Query parameters for funding radar and cost-adjusted funding arbitrage.
 */
export interface FundingRadarQueryParams {
  exchange?: SupportedExchange | 'all';
  limit?: number;
}

export interface FundingArbitrageQueryParams {
  limit?: number;
  executionCostBps?: number;
}

/**
 * Query parameters for Technical Indicators endpoint
 */
export interface TechnicalIndicatorQueryParams {
  timeframe: Timeframe; // Required timeframe for candles
  type?: 'spot' | 'perp'; // Market type (default: 'spot')
  limit?: number; // Number of candles to fetch (default: 300, max: 1000)
  sma?: string; // Comma-separated SMA periods (e.g., "20,50,200")
  ema?: string; // Comma-separated EMA periods (e.g., "9,12,21,26")
  rsi?: string; // Comma-separated RSI periods (e.g., "14")
}

/**
 * Query parameters for Order Book endpoint
 */
export interface OrderBookQueryParams {
  type?: 'spot' | 'perp'; // Market type (default: 'spot')
  limit?: number; // Number of price levels per side (default: 50, max: 500)
}

/**
 * Query parameters for liquidation radar and CVD/order-flow overlays.
 */
export interface LiquidationRadarQueryParams {
  limit?: number;
}

export interface OrderFlowQueryParams {
  timeframe: Timeframe;
  type?: 'spot' | 'perp';
  limit?: number;
}

/**
 * Query parameters for price arbitrage endpoint
 */
export interface PriceArbitrageQueryParams {
  type?: 'spot' | 'perp';
  quote?: string;
  minSpreadBps?: number;
  limit?: number;
}

/**
 * Query parameters for trending volume-spike discovery.
 */
export interface TrendingVolumeQueryParams {
  type?: 'spot' | 'perp';
  limit?: number;
  minRatio?: number;
}

/**
 * Query parameters for public Alpha Feed.
 */
export interface AlphaFeedQueryParams {
  exchange?: SupportedExchange;
  limit?: number;
}

/**
 * Server-side backtest request.
 */
export interface BacktestRequest {
  timeframe: Timeframe;
  type?: 'spot' | 'perp';
  limit?: number;
  since?: number;
  until?: number;
  strategy?: Partial<StrategyDefinition>;
}

/**
 * Query parameters shared by institutional intelligence endpoints
 */
export interface InstitutionalAssetQueryParams {
  asset?: InstitutionalAsset;
}

/**
 * Query parameters for ETF flow and options volatility history.
 */
export interface InstitutionalRangeQueryParams extends InstitutionalAssetQueryParams {
  range?: InstitutionalRange;
}

/**
 * Query parameters for options chain endpoint.
 */
export interface OptionsChainQueryParams extends InstitutionalAssetQueryParams {
  expiry?: string;
}

/**
 * EMA data point with OHLCV and all period values
 */
export interface EMADataPoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  emas: Record<number, number>;
}

/**
 * SuperEMA response structure
 */
export interface SuperEMAResponse {
  exchange: string;
  symbol: string;
  timeframe: string;
  marketType: 'spot' | 'perp';
  periods: number[];
  data: EMADataPoint[];
  candleCount: number;
}

/**
 * Build query string from parameters
 */
function buildQueryString(params?: QueryParams): string {
  if (!params) return '';

  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value));
    }
  });

  const queryString = queryParams.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Fetch with timeout support
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param timeout - Timeout in milliseconds (default: 30000)
 * @returns Promise that resolves to Response or rejects on timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Base fetch wrapper with error handling and timeout support
 *
 * @param endpoint - API endpoint path
 * @param queryParams - Optional query parameters
 * @param timeout - Request timeout in ms
 * @param requestInit - Optional custom RequestInit (for POST, etc.)
 */
async function apiFetch<T>(
  endpoint: string,
  queryParams?: QueryParams,
  timeout?: number,
  requestInit?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const queryString = buildQueryString(queryParams);

    const response = await fetchWithTimeout(
      `${API_BASE_URL}${endpoint}${queryString}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        ...requestInit,
      },
      timeout
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: ApiResponse<T> = await response.json();
    return data;
  } catch (error) {
    // Return error in standard API response format
    return {
      success: false,
      data: null as T,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: Date.now(),
    };
  }
}

/**
 * POST fetch wrapper for endpoints that require request body
 */
async function apiPost<T>(
  endpoint: string,
  body: unknown,
  timeout?: number
): Promise<ApiResponse<T>> {
  try {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      timeout
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: ApiResponse<T> = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
      data: null as T,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: Date.now(),
    };
  }
}

async function apiPostWithBearer<T>(
  endpoint: string,
  sessionToken: string,
  body: unknown,
  timeout?: number
): Promise<ApiResponse<T>> {
  return apiFetch<T>(endpoint, undefined, timeout, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(body),
  });
}

async function apiGetWithBearer<T>(
  endpoint: string,
  sessionToken: string,
  timeout?: number
): Promise<ApiResponse<T>> {
  return apiFetch<T>(endpoint, undefined, timeout, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });
}

async function apiDeleteWithBearer<T>(
  endpoint: string,
  sessionToken: string,
  timeout?: number
): Promise<ApiResponse<T>> {
  return apiFetch<T>(endpoint, undefined, timeout, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });
}

/**
 * API Client class with methods for all endpoints
 */
export class LazuliAPI {
  static async requestMagicLink(email: string): Promise<ApiResponse<AuthMagicLinkResponse>> {
    return apiPost<AuthMagicLinkResponse>(`${API_VERSION}/auth/magic-link`, { email });
  }

  static async verifyMagicLink(token: string): Promise<ApiResponse<AuthSessionResponse>> {
    return apiPost<AuthSessionResponse>(`${API_VERSION}/auth/magic-link/verify`, { token });
  }

  static async createPasskeyRegistrationOptions(
    sessionToken: string
  ): Promise<ApiResponse<PasskeyRegistrationOptionsResponse>> {
    return apiPostWithBearer<PasskeyRegistrationOptionsResponse>(
      `${API_VERSION}/auth/passkeys/registration/options`,
      sessionToken,
      {}
    );
  }

  static async verifyPasskeyRegistration(
    sessionToken: string,
    challengeId: string,
    response: Record<string, unknown>,
    name?: string
  ): Promise<ApiResponse<PasskeyRecord>> {
    return apiPostWithBearer<PasskeyRecord>(
      `${API_VERSION}/auth/passkeys/registration/verify`,
      sessionToken,
      { challengeId, response, name }
    );
  }

  static async createPasskeyAuthenticationOptions(
    email?: string
  ): Promise<ApiResponse<PasskeyAuthenticationOptionsResponse>> {
    return apiPost<PasskeyAuthenticationOptionsResponse>(
      `${API_VERSION}/auth/passkeys/authentication/options`,
      email ? { email } : {}
    );
  }

  static async verifyPasskeyAuthentication(
    challengeId: string,
    response: Record<string, unknown>
  ): Promise<ApiResponse<AuthSessionResponse>> {
    return apiPost<AuthSessionResponse>(`${API_VERSION}/auth/passkeys/authentication/verify`, {
      challengeId,
      response,
    });
  }

  static async listPasskeys(sessionToken: string): Promise<ApiResponse<PasskeyRecord[]>> {
    return apiGetWithBearer<PasskeyRecord[]>(`${API_VERSION}/me/passkeys`, sessionToken);
  }

  static async deletePasskey(
    sessionToken: string,
    id: string
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    return apiDeleteWithBearer<{ deleted: boolean }>(
      `${API_VERSION}/me/passkeys/${encodeURIComponent(id)}`,
      sessionToken
    );
  }

  /**
   * Get list of all supported exchanges
   */
  static async getExchanges(): Promise<ApiResponse<ExchangeInfo[]>> {
    return apiFetch<ExchangeInfo[]>(`${API_VERSION}/exchanges`);
  }

  /**
   * Get all tickers for a specific exchange with optional filtering and pagination
   */
  static async getTickers(
    exchange: SupportedExchange,
    queryParams?: TickersQueryParams
  ): Promise<ApiResponse<TickersResponse>> {
    return apiFetch<TickersResponse>(`${API_VERSION}/tickers/${exchange}`, queryParams);
  }

  /**
   * Get ticker data for a specific symbol on an exchange
   */
  static async getTicker(
    exchange: SupportedExchange,
    symbol: string
  ): Promise<ApiResponse<Ticker>> {
    // URL encode the symbol to handle special characters like /
    const encodedSymbol = encodeURIComponent(symbol);
    return apiFetch<Ticker>(`${API_VERSION}/tickers/${exchange}/${encodedSymbol}`);
  }

  /**
   * Get the public Alpha Feed composed from live market signals.
   */
  static async getAlphaFeed(
    queryParams?: AlphaFeedQueryParams
  ): Promise<ApiResponse<AlphaFeedResponse>> {
    return apiFetch<AlphaFeedResponse>(`${API_VERSION}/alpha-feed`, queryParams, 60000);
  }

  /**
   * Read one persisted Alpha Feed event by permalink id.
   */
  static async getAlphaFeedEvent(id: string): Promise<ApiResponse<AlphaFeedItem>> {
    return apiFetch<AlphaFeedItem>(`${API_VERSION}/alpha-feed/${encodeURIComponent(id)}`);
  }

  /**
   * Build an API-served SVG snapshot URL for market sharing and OG previews.
   */
  static getMarketSnapshotUrl(
    exchange: SupportedExchange,
    symbol: string,
    type?: 'spot' | 'perp'
  ): string {
    const encodedSymbol = encodeURIComponent(symbol);
    const query = type ? `?type=${type}` : '';
    return `${API_BASE_URL}${API_VERSION}/snapshots/market/${exchange}/${encodedSymbol}.svg${query}`;
  }

  /**
   * Get all markets for a specific exchange with optional filtering and pagination
   */
  static async getMarkets(
    exchange: SupportedExchange,
    queryParams?: MarketsQueryParams
  ): Promise<ApiResponse<MarketsResponse>> {
    return apiFetch<MarketsResponse>(`${API_VERSION}/markets/${exchange}`, queryParams);
  }

  /**
   * Health check - get API status
   */
  static async getHealth(): Promise<ApiResponse<HealthResponse>> {
    return apiFetch<HealthResponse>(`${API_VERSION}/health`);
  }

  /**
   * Get OHLCV (candlestick) data for a specific symbol and timeframe
   */
  static async getOHLCV(
    exchange: SupportedExchange,
    symbol: string,
    queryParams: OHLCVQueryParams
  ): Promise<ApiResponse<OHLCVResponse>> {
    const encodedSymbol = encodeURIComponent(symbol);
    return apiFetch<OHLCVResponse>(
      `${API_VERSION}/ohlcv/${exchange}/${encodedSymbol}`,
      queryParams
    );
  }

  /**
   * Get OHLCV data for multiple timeframes at once
   */
  static async getMultiTimeframeOHLCV(
    exchange: SupportedExchange,
    symbol: string,
    queryParams: MultiTimeframeOHLCVQueryParams
  ): Promise<ApiResponse<MultiTimeframeOHLCVResponse>> {
    const encodedSymbol = encodeURIComponent(symbol);
    // Convert timeframes array to comma-separated string
    const params = {
      ...queryParams,
      timeframes: queryParams.timeframes.join(','),
    };
    return apiFetch<MultiTimeframeOHLCVResponse>(
      `${API_VERSION}/ohlcv/multi/${exchange}/${encodedSymbol}`,
      params
    );
  }

  /**
   * Generate synthetic pair OHLCV data by dividing two ticker prices
   * Example: BTC-USDT / AVAX-USDT = BTC/AVAX synthetic pair
   * Uses extended timeout (60s) as it fetches data for two symbols
   */
  static async getCustomPair(
    exchange: SupportedExchange,
    symbol1: string,
    symbol2: string,
    queryParams: CustomPairQueryParams
  ): Promise<ApiResponse<CustomPairResponse>> {
    const encodedSymbol1 = encodeURIComponent(symbol1);
    const encodedSymbol2 = encodeURIComponent(symbol2);
    // Use 60s timeout for synthetic pair (fetches 2 symbols + calculation)
    return apiFetch<CustomPairResponse>(
      `${API_VERSION}/custom-pair/${exchange}/${encodedSymbol1}/${encodedSymbol2}`,
      queryParams,
      60000
    );
  }

  /**
   * Calculate custom index performance with weighted assets
   * Creates a basket of coins and compares performance to BTC/ETH/SOL benchmarks
   * Uses extended timeout (120s) as it fetches data for multiple assets
   */
  static async calculateCustomIndex(
    request: CustomIndexRequest
  ): Promise<ApiResponse<CustomIndexResponse>> {
    // Use 120s timeout for custom index (fetches multiple assets + benchmarks)
    return apiPost<CustomIndexResponse>(`${API_VERSION}/custom-index`, request, 120000);
  }

  /**
   * Get SuperEMA data (1-400 EMA periods) for a specific symbol
   * Uses extended timeout (90s) due to heavy computation
   */
  static async getSuperEMA(
    exchange: SupportedExchange,
    symbol: string,
    queryParams: SuperEMAQueryParams
  ): Promise<ApiResponse<SuperEMAResponse>> {
    const encodedSymbol = encodeURIComponent(symbol);
    // Use 90s timeout for SuperEMA (heavy computation)
    return apiFetch<SuperEMAResponse>(
      `${API_VERSION}/superema/${exchange}/${encodedSymbol}`,
      queryParams,
      90000
    );
  }

  /**
   * Get technical indicators (SMA, EMA, RSI) for a specific symbol
   * Calculates multiple indicators server-side for chart overlays
   *
   * @param exchange - Exchange to fetch data from
   * @param symbol - Trading pair symbol (e.g., BTC-USDT)
   * @param queryParams - Query parameters including timeframe and indicator periods
   * @returns Technical indicator data aligned with OHLCV timestamps
   *
   * @example
   * // Get default indicators (SMA 20,50,200; EMA 9,12,21,26; RSI 14)
   * LazuliAPI.getTechnicalIndicators('binance', 'BTC-USDT', { timeframe: '1h' })
   *
   * // Get custom indicator periods
   * LazuliAPI.getTechnicalIndicators('binance', 'BTC-USDT', {
   *   timeframe: '4h',
   *   sma: '10,20,50',
   *   ema: '12,26',
   *   rsi: '14'
   * })
   */
  static async getTechnicalIndicators(
    exchange: SupportedExchange,
    symbol: string,
    queryParams: TechnicalIndicatorQueryParams
  ): Promise<ApiResponse<TechnicalIndicatorResponse>> {
    const encodedSymbol = encodeURIComponent(symbol);
    // Use 60s timeout for indicators (computation + OHLCV fetch)
    return apiFetch<TechnicalIndicatorResponse>(
      `${API_VERSION}/indicators/${exchange}/${encodedSymbol}`,
      queryParams,
      60000
    );
  }

  /**
   * Get all altcoins with performance data for Alt Screener
   * Scans all altcoins (excluding BTC) and returns performance metrics
   *
   * @param exchange - Exchange to fetch from
   * @param queryParams - Query parameters including optional 'lightweight' flag
   *
   * When lightweight=true (default for initial load):
   * - Returns data instantly (~1-2s) without OHLCV chart data
   * - Client should then fetch OHLCV lazily for visible rows
   *
   * When lightweight=false:
   * - Returns full data with OHLCV (~20-30s on cache miss)
   * - Use for background refresh or when charts are needed immediately
   */
  static async getAltScreener(
    exchange: SupportedExchange,
    queryParams?: AltScreenerQueryParams & { lightweight?: boolean }
  ): Promise<ApiResponse<AltScreenerResponse>> {
    // Shorter timeout for lightweight (15s), longer for full (120s)
    const timeout = queryParams?.lightweight ? 15000 : 120000;
    return apiFetch<AltScreenerResponse>(
      `${API_VERSION}/screener/${exchange}`,
      queryParams,
      timeout
    );
  }

  /**
   * Get quick stats for Alt Screener
   * Lightweight endpoint for summary statistics
   */
  static async getAltScreenerStats(
    exchange: SupportedExchange
  ): Promise<
    ApiResponse<{ exchange: string; stats: AltScreenerResponse['stats']; timestamp: number }>
  > {
    return apiFetch<{ exchange: string; stats: AltScreenerResponse['stats']; timestamp: number }>(
      `${API_VERSION}/screener/${exchange}/stats`
    );
  }

  /**
   * Batch fetch OHLCV data for specific symbols (for lazy loading)
   * Used for progressive loading - fetch chart data only for visible rows
   *
   * @param exchange - Exchange to fetch from
   * @param symbols - Array of symbols to fetch OHLCV for (max 50)
   * @param period - Performance period for chart granularity (default: 24h)
   * @returns Map of symbol -> OHLCV data
   */
  static async getOhlcvBatch(
    exchange: SupportedExchange,
    symbols: string[],
    period: string = '24h'
  ): Promise<
    ApiResponse<{
      exchange: string;
      period: string;
      ohlcv: Record<
        string,
        Array<{
          timestamp: number;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }>
      >;
      count: number;
      timestamp: number;
    }>
  > {
    // POST request with JSON body
    return apiFetch(`${API_VERSION}/screener/${exchange}/ohlcv`, undefined, 30000, {
      method: 'POST',
      body: JSON.stringify({ symbols, period }),
    });
  }

  /**
   * Get funding rates for all perpetual contracts on an exchange
   * Provides funding rate data for sentiment analysis and arbitrage opportunities
   * Uses extended timeout (60s) due to fetching many symbols
   *
   * @param exchange - Exchange to fetch funding rates from
   * @param queryParams - Optional query parameters (sortBy, sortOrder, limit)
   */
  static async getFundingRates(
    exchange: SupportedExchange,
    queryParams?: FundingRateQueryParams
  ): Promise<ApiResponse<FundingRateResponse>> {
    // Use 60s timeout for funding rates (fetches many symbols)
    return apiFetch<FundingRateResponse>(`${API_VERSION}/funding/${exchange}`, queryParams, 60000);
  }

  /**
   * Get cross-exchange funding rate comparison
   * Compares funding rates across all exchanges to identify arbitrage opportunities
   * Uses extended timeout (90s) due to fetching from multiple exchanges
   *
   * @param queryParams - Optional query parameters (limit)
   */
  static async getCrossExchangeFunding(
    queryParams?: CrossExchangeFundingQueryParams
  ): Promise<ApiResponse<CrossExchangeFundingResponse>> {
    // Use 90s timeout for cross-exchange comparison (fetches from all exchanges)
    return apiFetch<CrossExchangeFundingResponse>(
      `${API_VERSION}/funding/compare`,
      queryParams,
      90000
    );
  }

  /**
   * Get OI-weighted funding and spike radar across one or all exchanges.
   */
  static async getFundingRadar(
    queryParams?: FundingRadarQueryParams
  ): Promise<ApiResponse<FundingRadarResponse>> {
    return apiFetch<FundingRadarResponse>(`${API_VERSION}/funding/radar`, queryParams, 90000);
  }

  /**
   * Get cost-adjusted cross-exchange funding arbitrage opportunities.
   */
  static async getFundingArbitrage(
    queryParams?: FundingArbitrageQueryParams
  ): Promise<ApiResponse<FundingArbitrageResponse>> {
    return apiFetch<FundingArbitrageResponse>(
      `${API_VERSION}/funding/arbitrage`,
      queryParams,
      90000
    );
  }

  /**
   * Get order book (market depth) data for a specific symbol
   * Returns bid/ask orders sorted by price with cumulative totals
   *
   * @param exchange - Exchange to fetch order book from
   * @param symbol - Trading pair symbol (e.g., BTC-USDT or BTCUSDT.P)
   * @param queryParams - Optional query parameters (type, limit)
   */
  static async getOrderBook(
    exchange: SupportedExchange,
    symbol: string,
    queryParams?: OrderBookQueryParams
  ): Promise<ApiResponse<OrderBookResponse>> {
    const encodedSymbol = encodeURIComponent(symbol);
    // Order book data is time-sensitive, use default timeout
    return apiFetch<OrderBookResponse>(
      `${API_VERSION}/orderbook/${exchange}/${encodedSymbol}`,
      queryParams
    );
  }

  /**
   * Get transparent estimated liquidation bands for a perpetual contract.
   */
  static async getLiquidationRadar(
    exchange: SupportedExchange,
    symbol: string,
    queryParams?: LiquidationRadarQueryParams
  ): Promise<ApiResponse<LiquidationRadarResponse>> {
    const encodedSymbol = encodeURIComponent(symbol);
    return apiFetch<LiquidationRadarResponse>(
      `${API_VERSION}/liquidations/${exchange}/${encodedSymbol}`,
      queryParams
    );
  }

  /**
   * Get CVD/order-flow proxy data for workspace overlays.
   */
  static async getOrderFlow(
    exchange: SupportedExchange,
    symbol: string,
    queryParams: OrderFlowQueryParams
  ): Promise<ApiResponse<OrderFlowResponse>> {
    const encodedSymbol = encodeURIComponent(symbol);
    return apiFetch<OrderFlowResponse>(
      `${API_VERSION}/orderflow/${exchange}/${encodedSymbol}`,
      queryParams,
      60000
    );
  }

  /**
   * Get cross-exchange price arbitrage opportunities
   * Compares normalized assets across supported exchanges and returns the
   * widest current price discrepancies for discovery and analysis.
   */
  static async getPriceArbitrage(
    queryParams?: PriceArbitrageQueryParams
  ): Promise<ApiResponse<PriceArbitrageResponse>> {
    return apiFetch<PriceArbitrageResponse>(`${API_VERSION}/arbitrage/prices`, queryParams, 60000);
  }

  /**
   * Get 24h-vs-7d volume spike discovery feed.
   */
  static async getTrendingVolume(
    exchange: SupportedExchange,
    queryParams?: TrendingVolumeQueryParams
  ): Promise<ApiResponse<TrendingVolumeResponse>> {
    return apiFetch<TrendingVolumeResponse>(
      `${API_VERSION}/trending/${exchange}`,
      queryParams,
      90000
    );
  }

  /**
   * Run a server-side strategy backtest against OHLCV history.
   */
  static async runBacktest(
    exchange: SupportedExchange,
    symbol: string,
    request: BacktestRequest
  ): Promise<ApiResponse<BacktestResponse>> {
    const encodedSymbol = encodeURIComponent(symbol);
    return apiPost<BacktestResponse>(
      `${API_VERSION}/backtest/${exchange}/${encodedSymbol}`,
      request,
      120000
    );
  }

  /**
   * Get the flagship institutional overview combining ETF flows, options,
   * perp leverage, and spot trend.
   */
  static async getInstitutionalOverview(
    queryParams?: InstitutionalAssetQueryParams
  ): Promise<ApiResponse<InstitutionalOverviewResponse>> {
    return apiFetch<InstitutionalOverviewResponse>(
      `${API_VERSION}/institutional/overview`,
      queryParams,
      60000
    );
  }

  /**
   * Get daily spot ETF flows with fund-level contributions.
   */
  static async getEtfFlows(
    queryParams?: InstitutionalRangeQueryParams
  ): Promise<ApiResponse<EtfFlowResponse>> {
    return apiFetch<EtfFlowResponse>(`${API_VERSION}/institutional/etf/flows`, queryParams, 60000);
  }

  /**
   * Get ETF fund metadata and cumulative fund leadership.
   */
  static async getEtfFunds(
    queryParams?: InstitutionalAssetQueryParams
  ): Promise<ApiResponse<EtfFundsResponse>> {
    return apiFetch<EtfFundsResponse>(`${API_VERSION}/institutional/etf/funds`, queryParams, 60000);
  }

  /**
   * Get normalized Deribit option chain data for one asset and expiry.
   */
  static async getOptionsChain(
    queryParams?: OptionsChainQueryParams
  ): Promise<ApiResponse<OptionsChainResponse>> {
    return apiFetch<OptionsChainResponse>(
      `${API_VERSION}/institutional/options/chain`,
      queryParams,
      60000
    );
  }

  /**
   * Get available options expiries and aggregate positioning.
   */
  static async getOptionsExpiries(
    queryParams?: InstitutionalAssetQueryParams
  ): Promise<ApiResponse<OptionsExpiriesResponse>> {
    return apiFetch<OptionsExpiriesResponse>(
      `${API_VERSION}/institutional/options/expiries`,
      queryParams,
      60000
    );
  }

  /**
   * Get Deribit volatility index history for IV regime charts.
   */
  static async getOptionsVolatility(
    queryParams?: InstitutionalRangeQueryParams
  ): Promise<ApiResponse<OptionsVolatilityResponse>> {
    return apiFetch<OptionsVolatilityResponse>(
      `${API_VERSION}/institutional/options/volatility`,
      queryParams,
      60000
    );
  }

  /**
   * Get the transparent institutional confluence signal matrix.
   */
  static async getInstitutionalConfluence(
    queryParams?: InstitutionalAssetQueryParams
  ): Promise<ApiResponse<InstitutionalConfluenceResponse>> {
    return apiFetch<InstitutionalConfluenceResponse>(
      `${API_VERSION}/institutional/confluence`,
      queryParams,
      60000
    );
  }
}

/**
 * Utility functions for working with API data
 */

/**
 * Format a number as USD currency
 */
export function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A';

  // Use dynamic precision for small values (memecoins, micro-cap tokens)
  const absValue = Math.abs(value);
  let minDecimals = 2;
  let maxDecimals = 2;

  if (absValue < 1) {
    // For prices < $1, calculate precision based on magnitude
    // Count leading zeros and add 4 significant digits
    if (absValue > 0) {
      const str = absValue.toExponential();
      const exponent = parseInt(str.split('e')[1], 10);
      maxDecimals = Math.min(Math.abs(exponent) + 4, 12);
      minDecimals = maxDecimals;
    }
  } else if (absValue < 1000) {
    // For prices >= $1 but < $1000, show 4 decimals
    minDecimals = 4;
    maxDecimals = 4;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

/**
 * Format a large number with K/M/B suffixes
 * @param value - The numeric value to format
 * @param currency - Optional currency code to display (e.g., 'USDT', 'BTC', 'IDRT')
 * @returns Formatted string with K/M/B suffix and optional currency
 */
export function formatVolume(value: number | null, currency?: string): string {
  if (value === null) return 'N/A';

  let formatted: string;
  if (value >= 1e9) {
    formatted = `${(value / 1e9).toFixed(2)}B`;
  } else if (value >= 1e6) {
    formatted = `${(value / 1e6).toFixed(2)}M`;
  } else if (value >= 1e3) {
    formatted = `${(value / 1e3).toFixed(2)}K`;
  } else {
    formatted = value.toFixed(2);
  }

  // If currency is provided, append it; otherwise return just the number
  return currency ? `${formatted} ${currency}` : formatted;
}

/**
 * Format percentage change with + or - sign
 */
export function formatPercentage(value: number | null): string {
  if (value === null) return 'N/A';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Get color class based on percentage change (for styling)
 */
export function getChangeColor(value: number | null): string {
  if (value === null) return 'text-muted-foreground';
  if (value > 0) return 'text-green-600 dark:text-green-400';
  if (value < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

/**
 * Format timestamp to readable date/time
 */
export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

/**
 * Format funding rate with sign and precision
 * @param rate - Funding rate as percentage (e.g., 0.01 for 0.01%)
 * @param showSign - Whether to show + sign for positive values
 */
export function formatFundingRate(rate: number | null, showSign: boolean = true): string {
  if (rate === null) return 'N/A';
  const sign = showSign && rate >= 0 ? '+' : '';
  return `${sign}${rate.toFixed(4)}%`;
}

/**
 * Format annualized rate with sign
 * @param rate - Annualized rate as percentage
 */
export function formatAnnualizedRate(rate: number | null): string {
  if (rate === null) return 'N/A';
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${rate.toFixed(2)}%`;
}

/**
 * Get color class based on funding rate
 * Positive = bullish (green), Negative = bearish (red)
 */
export function getFundingColor(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate > 0.01) return 'text-green-500'; // Strong positive
  if (rate > 0) return 'text-green-400'; // Positive
  if (rate < -0.01) return 'text-red-500'; // Strong negative
  if (rate < 0) return 'text-red-400'; // Negative
  return 'text-muted-foreground'; // Neutral
}
