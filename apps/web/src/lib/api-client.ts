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
  CrossExchangeFundingResponse,
  TechnicalIndicatorResponse,
  OrderBookResponse,
  LiquidationEvent,
  LiquidationStats,
  LiquidationHeatmap,
  CascadeAlert,
  LiquidationZone,
  AggregatedLiquidations,
  LiveLiquidationFeed,
  LiquidationExchange,
} from '@lazuli/shared';

// API base URL - defaults to localhost in development
// Vite exposes environment variables via import.meta.env with VITE_ prefix
// Falls back to http://localhost:3000 if not configured
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_VERSION = '/api/v1';

// Default timeout for API requests (30 seconds)
const DEFAULT_TIMEOUT = 30000;

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
 * Query parameters for Liquidation endpoints
 */
export interface LiquidationQueryParams {
  limit?: number; // Maximum number of liquidations (default: 100, max: 500)
  symbol?: string; // Optional symbol filter (e.g., "BTCUSDT")
  since?: number; // Timestamp in ms to fetch liquidations since
}

/**
 * Query parameters for Liquidation Stats endpoint
 */
export interface LiquidationStatsQueryParams {
  period?: '1h' | '4h' | '24h'; // Time period for stats (default: '24h')
  symbol?: string; // Optional symbol filter
}

/**
 * Query parameters for Liquidation Heatmap endpoint
 */
export interface LiquidationHeatmapQueryParams {
  buckets?: number; // Number of price buckets (default: 50, min: 10, max: 100)
}

/**
 * Query parameters for Cascade Alerts endpoint
 */
export interface CascadeAlertsQueryParams {
  threshold?: number; // Minimum USD value to trigger cascade (default: $1M)
}

/**
 * Response structure for liquidation list endpoints
 */
export interface LiquidationResponse {
  exchange: string;
  symbol: string;
  liquidations: LiquidationEvent[];
  count: number;
  timestamp: number;
}

/**
 * Response structure for cascade alerts endpoint
 */
export interface CascadeAlertsResponse {
  cascades: CascadeAlert[];
  count: number;
  threshold: number;
  timestamp: number;
}

/**
 * Response structure for liquidation zones endpoint
 */
export interface LiquidationZonesResponse {
  zones: LiquidationZone[];
  count: number;
  exchange: string;
  symbol: string;
  timestamp: number;
}

/**
 * Response structure for supported exchanges endpoint
 */
export interface SupportedLiquidationExchangesResponse {
  exchanges: LiquidationExchange[];
  count: number;
  timestamp: number;
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
function buildQueryString(params?: Record<string, any>): string {
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
 */
async function apiFetch<T>(
  endpoint: string,
  queryParams?: Record<string, any>,
  timeout?: number
): Promise<ApiResponse<T>> {
  try {
    const queryString = buildQueryString(queryParams);

    const response = await fetchWithTimeout(
      `${API_BASE_URL}${endpoint}${queryString}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
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
  body: Record<string, any>,
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

/**
 * API Client class with methods for all endpoints
 */
export class LazuliAPI {
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
  ): Promise<ApiResponse<any>> {
    const encodedSymbol = encodeURIComponent(symbol);
    // Convert timeframes array to comma-separated string
    const params = {
      ...queryParams,
      timeframes: queryParams.timeframes.join(','),
    };
    return apiFetch<any>(`${API_VERSION}/ohlcv/multi/${exchange}/${encodedSymbol}`, params);
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
   * Uses extended timeout (120s) due to fetching data for many symbols
   */
  static async getAltScreener(
    exchange: SupportedExchange,
    queryParams?: AltScreenerQueryParams
  ): Promise<ApiResponse<AltScreenerResponse>> {
    // Use 120s timeout for screener (fetches many symbols with OHLCV)
    return apiFetch<AltScreenerResponse>(
      `${API_VERSION}/screener/${exchange}`,
      queryParams,
      120000
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

  // ============================================================================
  // Liquidation Monitor API Methods
  // ============================================================================

  /**
   * Get list of exchanges that support liquidation data
   */
  static async getSupportedLiquidationExchanges(): Promise<
    ApiResponse<SupportedLiquidationExchangesResponse>
  > {
    return apiFetch<SupportedLiquidationExchangesResponse>(`${API_VERSION}/liquidations/supported`);
  }

  /**
   * Get recent liquidations from an exchange
   *
   * @param exchange - Exchange identifier (binance, bybit, okx, hyperliquid)
   * @param queryParams - Optional query parameters (limit, symbol, since)
   */
  static async getLiquidations(
    exchange: LiquidationExchange,
    queryParams?: LiquidationQueryParams
  ): Promise<ApiResponse<LiquidationResponse>> {
    return apiFetch<LiquidationResponse>(`${API_VERSION}/liquidations/${exchange}`, queryParams);
  }

  /**
   * Get liquidations for a specific symbol on an exchange
   *
   * @param exchange - Exchange identifier
   * @param symbol - Trading pair symbol (e.g., "BTCUSDT")
   * @param queryParams - Optional query parameters (limit, since)
   */
  static async getLiquidationsBySymbol(
    exchange: LiquidationExchange,
    symbol: string,
    queryParams?: Omit<LiquidationQueryParams, 'symbol'>
  ): Promise<ApiResponse<LiquidationResponse>> {
    const encodedSymbol = encodeURIComponent(symbol);
    return apiFetch<LiquidationResponse>(
      `${API_VERSION}/liquidations/${exchange}/${encodedSymbol}`,
      queryParams
    );
  }

  /**
   * Get aggregated liquidations across all exchanges for a symbol
   * Combines data from Binance, Bybit, OKX, and Hyperliquid
   *
   * @param symbol - Trading pair symbol (e.g., "BTCUSDT")
   * @param limit - Maximum number of liquidations to return (default: 50)
   */
  static async getAggregatedLiquidations(
    symbol: string,
    limit?: number
  ): Promise<ApiResponse<AggregatedLiquidations>> {
    const encodedSymbol = encodeURIComponent(symbol);
    return apiFetch<AggregatedLiquidations>(
      `${API_VERSION}/liquidations/aggregate/${encodedSymbol}`,
      limit ? { limit } : undefined
    );
  }

  /**
   * Get liquidation statistics for analytics dashboard
   * Includes volume, counts, long/short ratio, intensity, top symbols
   *
   * @param exchange - Exchange identifier
   * @param queryParams - Optional query parameters (period, symbol)
   */
  static async getLiquidationStats(
    exchange: LiquidationExchange,
    queryParams?: LiquidationStatsQueryParams
  ): Promise<ApiResponse<LiquidationStats>> {
    return apiFetch<LiquidationStats>(`${API_VERSION}/liquidations/stats/${exchange}`, queryParams);
  }

  /**
   * Get liquidation heatmap data for visualization
   * Shows liquidation density at different price levels
   *
   * @param exchange - Exchange identifier
   * @param symbol - Trading pair symbol (e.g., "BTCUSDT.P")
   * @param queryParams - Optional query parameters (buckets)
   */
  static async getLiquidationHeatmap(
    exchange: LiquidationExchange,
    symbol: string,
    queryParams?: LiquidationHeatmapQueryParams
  ): Promise<ApiResponse<LiquidationHeatmap>> {
    const encodedSymbol = encodeURIComponent(symbol);
    return apiFetch<LiquidationHeatmap>(
      `${API_VERSION}/liquidations/heatmap/${exchange}/${encodedSymbol}`,
      queryParams
    );
  }

  /**
   * Get active cascade alerts across all exchanges
   * Triggered when liquidation volume exceeds threshold
   *
   * @param queryParams - Optional query parameters (threshold)
   */
  static async getCascadeAlerts(
    queryParams?: CascadeAlertsQueryParams
  ): Promise<ApiResponse<CascadeAlertsResponse>> {
    return apiFetch<CascadeAlertsResponse>(`${API_VERSION}/liquidations/cascades`, queryParams);
  }

  /**
   * Get high-risk liquidation zones for a symbol
   * Identifies price areas with historically high liquidation activity
   *
   * @param exchange - Exchange identifier
   * @param symbol - Trading pair symbol
   */
  static async getLiquidationZones(
    exchange: LiquidationExchange,
    symbol: string
  ): Promise<ApiResponse<LiquidationZonesResponse>> {
    const encodedSymbol = encodeURIComponent(symbol);
    return apiFetch<LiquidationZonesResponse>(
      `${API_VERSION}/liquidations/zones/${exchange}/${encodedSymbol}`
    );
  }

  /**
   * Get live liquidation feed with rolling statistics
   * Includes recent events, 1m/5m/15m summaries, and active cascades
   *
   * @param exchange - Exchange identifier
   * @param queryParams - Optional query parameters (symbol, limit)
   */
  static async getLiquidationFeed(
    exchange: LiquidationExchange,
    queryParams?: { symbol?: string; limit?: number }
  ): Promise<ApiResponse<LiveLiquidationFeed>> {
    return apiFetch<LiveLiquidationFeed>(
      `${API_VERSION}/liquidations/feed/${exchange}`,
      queryParams
    );
  }

  /**
   * Get WebSocket connection status for liquidation streams
   */
  static async getLiquidationWebSocketStatus(): Promise<
    ApiResponse<{
      connections: Record<LiquidationExchange, { connected: boolean; lastMessage: number }>;
      recentEventsCount: number;
      isConnected: boolean;
      timestamp: number;
    }>
  > {
    return apiFetch(`${API_VERSION}/liquidations/ws/status`);
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
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

// ============================================================================
// Liquidation Utility Functions
// ============================================================================

/**
 * Format liquidation value with appropriate unit
 * Values under $1K show exact amount, larger values use K/M/B suffixes
 */
export function formatLiquidationValue(value: number): string {
  if (value >= 1e9) {
    return `$${(value / 1e9).toFixed(2)}B`;
  } else if (value >= 1e6) {
    return `$${(value / 1e6).toFixed(2)}M`;
  } else if (value >= 1e3) {
    return `$${(value / 1e3).toFixed(1)}K`;
  } else {
    return `$${value.toFixed(0)}`;
  }
}

/**
 * Format time ago from timestamp
 * Returns human-readable relative time (e.g., "2s ago", "5m ago")
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 1000) {
    return 'just now';
  } else if (diff < 60000) {
    const seconds = Math.floor(diff / 1000);
    return `${seconds}s ago`;
  } else if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  } else if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  } else {
    const days = Math.floor(diff / 86400000);
    return `${days}d ago`;
  }
}

/**
 * Get color class for liquidation side
 * Long liquidation = bearish (red), Short liquidation = bullish (green)
 */
export function getLiquidationSideColor(side: 'long' | 'short'): string {
  return side === 'long' ? 'text-red-500 dark:text-red-400' : 'text-green-500 dark:text-green-400';
}

/**
 * Get background color class for liquidation side
 */
export function getLiquidationSideBgColor(side: 'long' | 'short'): string {
  return side === 'long'
    ? 'bg-red-500/10 border-red-500/30'
    : 'bg-green-500/10 border-green-500/30';
}

/**
 * Get color class for cascade severity
 */
export function getCascadeSeverityColor(severity: 'warning' | 'critical' | 'extreme'): string {
  switch (severity) {
    case 'warning':
      return 'text-yellow-500 dark:text-yellow-400';
    case 'critical':
      return 'text-red-500 dark:text-red-400';
    case 'extreme':
      return 'text-purple-500 dark:text-purple-400';
    default:
      return 'text-muted-foreground';
  }
}

/**
 * Get background color class for cascade severity
 */
export function getCascadeSeverityBgColor(severity: 'warning' | 'critical' | 'extreme'): string {
  switch (severity) {
    case 'warning':
      return 'bg-yellow-500/10 border-yellow-500/30';
    case 'critical':
      return 'bg-red-500/10 border-red-500/30';
    case 'extreme':
      return 'bg-purple-500/10 border-purple-500/30';
    default:
      return 'bg-muted border-border';
  }
}

/**
 * Get color class for liquidation zone risk level
 */
export function getZoneRiskColor(risk: 'low' | 'medium' | 'high' | 'extreme'): string {
  switch (risk) {
    case 'low':
      return 'text-blue-500 dark:text-blue-400';
    case 'medium':
      return 'text-yellow-500 dark:text-yellow-400';
    case 'high':
      return 'text-orange-500 dark:text-orange-400';
    case 'extreme':
      return 'text-red-500 dark:text-red-400';
    default:
      return 'text-muted-foreground';
  }
}

/**
 * Format long/short ratio with visual indicator
 */
export function formatLongShortRatio(ratio: number): {
  text: string;
  indicator: 'bullish' | 'bearish' | 'neutral';
} {
  if (ratio === Infinity) {
    return { text: 'All Longs', indicator: 'bearish' };
  }
  if (ratio === 0) {
    return { text: 'All Shorts', indicator: 'bullish' };
  }

  const formatted = ratio.toFixed(2);

  if (ratio > 1.5) {
    return { text: formatted, indicator: 'bearish' };
  }
  if (ratio < 0.67) {
    return { text: formatted, indicator: 'bullish' };
  }
  return { text: formatted, indicator: 'neutral' };
}
