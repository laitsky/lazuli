/**
 * Shared types and interfaces between API and Web applications
 * This package provides type safety across the full stack
 */

/**
 * Standard API response wrapper for all endpoints
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  error: string | null;
  timestamp: number;
  meta?: ApiResponseMeta;
}

/**
 * Optional response metadata used for tracing, cache status, and throttling.
 */
export interface ApiResponseMeta {
  requestId?: string;
  cache?: {
    source?: string;
    ageMs?: number;
    stale?: boolean;
    refreshError?: string;
  };
  rateLimit?: {
    remaining?: number;
    retryAfterMs?: number;
    unavailable?: boolean;
  };
  [key: string]: unknown;
}

/**
 * Ticker data structure (cryptocurrency market data)
 *
 * Symbol Notation:
 * - Spot markets: BTC-USDT, SOL-USDT (hyphen separator)
 * - Perpetual markets: BTCUSDT.P, SOLUSDT.P (.P suffix)
 */
export interface Ticker {
  symbol: string; // Trading pair symbol (e.g., BTC-USDT for spot, BTCUSDT.P for perp)
  exchange: string; // Exchange identifier
  type: 'spot' | 'perp'; // Market type
  bid: number | null; // Highest bid price
  ask: number | null; // Lowest ask price
  last: number | null; // Last traded price
  high24h: number | null; // 24h highest price
  low24h: number | null; // 24h lowest price
  volume24h: number | null; // 24h base volume
  quoteVolume24h: number | null; // 24h quote volume
  change24h: number | null; // 24h absolute change
  percentage24h: number | null; // 24h percentage change
  timestamp: number; // Data timestamp
  fundingRate?: number | null; // Perpetual funding rate (perp only)
  openInterest?: number | null; // Perpetual open interest (perp only)
}

/**
 * Market information structure
 *
 * Symbol Notation:
 * - Spot markets: BTC-USDT, SOL-USDT (hyphen separator)
 * - Perpetual markets: BTCUSDT.P, SOLUSDT.P (.P suffix)
 */
export interface Market {
  id: string; // Market identifier
  symbol: string; // Trading pair symbol (e.g., BTC-USDT for spot, BTCUSDT.P for perp)
  base: string; // Base currency
  quote: string; // Quote currency
  type: 'spot' | 'perp'; // Market type
  active: boolean; // Is market active
  exchange: string; // Exchange identifier
}

/**
 * Exchange capabilities information
 */
export interface ExchangeInfo {
  name: string; // Display name
  id: string; // Exchange identifier
  supported: boolean; // Is supported
  hasSpot: boolean; // Has spot markets
  hasPerp: boolean; // Has perpetual markets
  notes?: string; // Optional operational caveat, e.g. regional availability
}

/**
 * Supported exchanges
 * - binance: Binance (spot + perpetual)
 * - bybit: Bybit (spot + perpetual)
 * - okx: OKX (spot + perpetual)
 * - hyperliquid: Hyperliquid DEX (perpetual only)
 * - upbit: Upbit Korea (spot only)
 */
export type SupportedExchange = 'binance' | 'bybit' | 'okx' | 'hyperliquid' | 'upbit';

/**
 * URL-addressable market workspace state.
 * These values are intentionally simple so the web app can share and restore
 * a complete analysis workspace from query parameters.
 */
export interface MarketWorkspaceState {
  exchange: SupportedExchange;
  symbol: string;
  type: 'spot' | 'perp';
  timeframe: Timeframe;
}

/**
 * Passwordless account profile returned by authenticated endpoints.
 */
export interface UserAccount {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: number;
  lastLoginAt: number | null;
}

/**
 * Magic-link request response. Only explicit local development exposes
 * `magicLink`; staging and production always deliver it out of band.
 */
export interface AuthMagicLinkResponse {
  email: string;
  expiresAt: number;
  delivered: boolean;
  magicLink: string | null;
}

/**
 * Session token returned after a magic link is verified.
 */
export interface AuthSessionResponse {
  user: UserAccount;
  sessionToken: string;
  expiresAt: number;
}

/**
 * Passkey credential metadata. Public keys and counters stay server-side.
 */
export interface PasskeyRecord {
  id: string;
  userId: string;
  credentialId: string;
  name: string | null;
  transports: string[];
  deviceType: string | null;
  backedUp: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

/**
 * WebAuthn option envelopes. The nested options are passed to
 * @simplewebauthn/browser on the client.
 */
export interface PasskeyRegistrationOptionsResponse {
  challengeId: string;
  options: Record<string, unknown>;
  expiresAt: number;
}

export interface PasskeyAuthenticationOptionsResponse {
  challengeId: string;
  options: Record<string, unknown>;
  expiresAt: number;
}

/**
 * Persisted workspace state for restoring URL-addressable analysis layouts.
 */
export interface SavedWorkspaceRecord {
  id: string;
  userId: string;
  name: string;
  state: Record<string, unknown>;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * User watchlist persisted server-side for cross-device retention.
 */
export interface WatchlistRecord {
  id: string;
  userId: string;
  name: string;
  items: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Saved server-side backtest definition and optional latest result snapshot.
 */
export interface SavedBacktestRecord {
  id: string;
  userId: string;
  name: string;
  exchange: string;
  symbol: string;
  timeframe: string;
  strategy: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Price alert persisted in D1 and evaluated against live exchange data.
 */
export interface PriceAlertRecord {
  id: number;
  userId: string | null;
  symbol: string;
  exchange: string;
  marketType: 'spot' | 'perp';
  priceTarget: number;
  condition: 'above' | 'below';
  active: boolean;
  triggeredAt: number | null;
  topic: string | null;
  delivery: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  lastPrice: number | null;
  lastEvaluatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Public API key metadata. The secret is returned only once on creation.
 */
export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/**
 * Public alpha-feed item composed from live market signals.
 */
export interface AlphaFeedItem {
  id: string;
  kind: 'trending' | 'funding-arbitrage' | 'liquidation' | 'price-arbitrage';
  title: string;
  summary: string;
  score: number;
  href: string;
  payload: Record<string, unknown>;
  timestamp: number;
  /** Public signal lifecycle metadata used by feeds, SEO, and stable permalinks. */
  expiresAt?: number;
  expired?: boolean;
}

export interface AlphaFeedResponse {
  items: AlphaFeedItem[];
  count: number;
  timestamp: number;
}

/**
 * Per-exchange quote used for cross-exchange price arbitrage discovery.
 */
export interface PriceArbitrageQuote {
  exchange: SupportedExchange;
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  last: number | null;
  timestamp: number;
}

/**
 * Best discovered price discrepancy for a normalized asset.
 */
export interface PriceArbitrageOpportunity {
  asset: string;
  marketType: 'spot' | 'perp';
  quoteCurrency: string;
  bestBuyExchange: SupportedExchange;
  bestSellExchange: SupportedExchange;
  buyPrice: number;
  sellPrice: number;
  spread: number;
  spreadBps: number;
  quotes: PriceArbitrageQuote[];
  timestamp: number;
}

/**
 * Response from /arbitrage/prices.
 */
export interface PriceArbitrageResponse {
  opportunities: PriceArbitrageOpportunity[];
  count: number;
  exchanges: SupportedExchange[];
  marketType: 'spot' | 'perp';
  quoteCurrency: string;
  minSpreadBps: number;
  timestamp: number;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number; // Current page number (1-indexed)
  limit: number; // Items per page
  total: number; // Total number of items
  totalPages: number; // Total number of pages
  hasNext: boolean; // Has next page
  hasPrev: boolean; // Has previous page
}

/**
 * Tickers response from /tickers/:exchange
 */
export interface TickersResponse {
  exchange: string;
  tickers: Ticker[];
  count: number;
  pagination?: PaginationMeta; // Optional pagination metadata
  filters?: {
    // Applied filters
    type?: 'spot' | 'perp';
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  };
}

/**
 * Markets response from /markets/:exchange
 */
export interface MarketsResponse {
  exchange: string;
  markets: Market[];
  count: number;
  pagination?: PaginationMeta; // Optional pagination metadata
  filters?: {
    // Applied filters
    type?: 'spot' | 'perp';
    search?: string;
    active?: boolean;
  };
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: string;
  api: string;
  database: string;
  exchanges: string[];
  timestamp: number;
}

/**
 * OHLCV candlestick data (Open, High, Low, Close, Volume)
 * Standard format for chart data across all timeframes
 */
export interface OHLCV {
  timestamp: number; // Candle start timestamp in milliseconds
  open: number; // Opening price
  high: number; // Highest price in the period
  low: number; // Lowest price in the period
  close: number; // Closing price
  volume: number; // Trading volume in base currency
}

/**
 * Supported timeframes for OHLCV data
 * Maps to standard exchange timeframe formats
 */
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '3d' | '1w';

/**
 * OHLCV response from /ohlcv/:exchange/:symbol
 *
 * Symbol uses standardized notation:
 * - Spot: BTC-USDT
 * - Perpetual: BTCUSDT.P
 */
export interface OHLCVResponse {
  exchange: string; // Exchange identifier
  symbol: string; // Trading pair symbol (BTC-USDT or BTCUSDT.P)
  timeframe: Timeframe; // Requested timeframe
  candles: OHLCV[]; // Array of candlestick data
  count: number; // Number of candles returned
}

/**
 * Custom pair response from /custom-pair/:exchange/:symbol1/:symbol2
 * Generated by dividing two ticker prices (symbol1 / symbol2)
 */
export interface CustomPairResponse {
  exchange: string; // Exchange identifier
  symbol1: string; // Numerator symbol (e.g., BTC-USDT)
  symbol2: string; // Denominator symbol (e.g., AVAX-USDT)
  customPairSymbol: string; // Resulting pair (e.g., BTC/AVAX)
  timeframe: Timeframe; // Requested timeframe
  marketType: 'spot' | 'perp'; // Market type
  candles: OHLCV[]; // Array of custom pair candlestick data
  count: number; // Number of candles returned
}

/**
 * Asset weight configuration for custom index
 * Each asset has a symbol and its weight in the index (as percentage)
 */
export interface IndexAsset {
  symbol: string; // Asset symbol (e.g., BTC-USDT)
  weight: number; // Weight percentage (0-100)
}

/**
 * Custom index performance data point
 * Shows the index value at a specific timestamp
 */
export interface IndexPerformancePoint {
  timestamp: number; // Timestamp in milliseconds
  value: number; // Normalized index value (starts at 100)
  change: number; // Percentage change from start
}

/**
 * Comparison benchmark data
 * Performance data for USDT/BTC/ETH/SOL benchmarks
 */
export interface BenchmarkPerformance {
  symbol: string; // Benchmark symbol
  name: string; // Display name
  data: IndexPerformancePoint[]; // Performance data points
}

/**
 * Custom index calculation request
 */
export interface CustomIndexRequest {
  name: string; // Index name
  assets: IndexAsset[]; // Array of assets with weights
  timeframe: Timeframe; // Timeframe for calculation
  exchange: SupportedExchange; // Exchange to use
}

/**
 * Custom index response with performance data
 */
export interface CustomIndexResponse {
  name: string; // Index name
  exchange: string; // Exchange used
  timeframe: Timeframe; // Timeframe used
  assets: IndexAsset[]; // Assets in the index
  performance: IndexPerformancePoint[]; // Index performance data
  benchmarks: BenchmarkPerformance[]; // Comparison benchmarks
  startTime: number; // Start timestamp
  endTime: number; // End timestamp
  totalReturn: number; // Total percentage return
}

// ============================================================================
// Alt Screener Types
// ============================================================================

/**
 * Base currency for comparing altcoin performance
 * USD = absolute price, BTC/ETH/SOL = relative to that asset
 */
export type BaseCurrency = 'USD' | 'BTC' | 'ETH' | 'SOL';

/**
 * Time period for performance calculation
 */
export type PerformancePeriod = '1h' | '4h' | '24h' | '7d' | '30d';

/**
 * Sort options for the alt screener
 */
export type ScreenerSortBy = 'performance' | 'volume' | 'name' | 'price';

/**
 * Performance data for a single altcoin
 * Includes OHLCV data and calculated metrics
 */
export interface AltcoinPerformance {
  symbol: string; // Trading pair symbol (e.g., SOL-USDT)
  base: string; // Base currency (e.g., SOL)
  quote: string; // Quote currency (e.g., USDT)
  exchange: string; // Exchange identifier
  type: 'spot' | 'perp'; // Market type
  price: number; // Current price in USD
  priceInBase: number; // Current price in selected base currency
  change1h: number | null; // 1 hour percentage change
  change4h: number | null; // 4 hour percentage change
  change24h: number | null; // 24 hour percentage change
  change7d: number | null; // 7 day percentage change (if available)
  volume24h: number | null; // 24 hour volume in quote currency
  high24h: number | null; // 24 hour high price
  low24h: number | null; // 24 hour low price
  ohlcv: OHLCV[]; // Recent OHLCV data for mini chart
  technical?: {
    rsi14: number | null;
    breakout: '24h-high' | '24h-low' | 'none';
    trend: 'above-ema20' | 'below-ema20' | 'unknown';
  };
  derivatives?: {
    fundingRatePercent: number | null;
    openInterestUsd: number | null;
  };
  rank?: number; // Rank by selected sort criteria
  timestamp: number; // Data timestamp
}

/**
 * Heatmap color intensity based on performance
 */
export interface HeatmapData {
  symbol: string;
  value: number; // Performance value for color calculation
  intensity: number; // Normalized intensity (0-1)
  color: 'green' | 'red' | 'neutral';
}

/**
 * Filter options for the alt screener
 */
export interface ScreenerFilters {
  minVolume?: number; // Minimum 24h volume in USD
  maxVolume?: number; // Maximum 24h volume in USD
  minChange?: number; // Minimum percentage change
  maxChange?: number; // Maximum percentage change
  minRsi?: number; // Minimum RSI(14) filter when technical scan is enabled
  maxRsi?: number; // Maximum RSI(14) filter when technical scan is enabled
  breakout?: 'up' | 'down' | 'any'; // 24h high/low breakout filter
  minFundingRate?: number; // Minimum perp funding rate percentage
  maxFundingRate?: number; // Maximum perp funding rate percentage
  minOpenInterest?: number; // Minimum perp open interest in USD
  type?: 'spot' | 'perp'; // Market type filter
  search?: string; // Symbol search query
}

/**
 * Request parameters for alt screener endpoint
 */
export interface AltScreenerRequest {
  exchange: SupportedExchange; // Exchange to fetch from
  baseCurrency: BaseCurrency; // Comparison base currency
  period: PerformancePeriod; // Performance calculation period
  sortBy: ScreenerSortBy; // Sort field
  sortOrder: 'asc' | 'desc'; // Sort direction
  limit?: number; // Maximum number of results
  filters?: ScreenerFilters; // Optional filters
}

/**
 * Base currency prices in USD for client-side calculations
 * Allows instant switching between comparison bases without API refetch
 */
export interface BaseCurrencyPrices {
  USD: 1; // Always 1 (USD is the reference)
  BTC: number; // BTC price in USD
  ETH: number; // ETH price in USD
  SOL: number; // SOL price in USD
}

/**
 * Response from alt screener endpoint
 */
export interface AltScreenerResponse {
  exchange: string; // Exchange identifier
  baseCurrency: BaseCurrency; // Comparison base used (initial/default)
  basePrice: number; // Current price of base currency in USD (for backwards compat)
  basePrices: BaseCurrencyPrices; // All base currency prices for client-side switching
  period: PerformancePeriod; // Performance period used
  altcoins: AltcoinPerformance[]; // Array of altcoin data (prices in USD)
  count: number; // Number of altcoins returned
  timestamp: number; // Response timestamp
  stats: {
    // Aggregate statistics
    totalAltcoins: number; // Total altcoins scanned
    gainers: number; // Count of gainers
    losers: number; // Count of losers
    avgChange: number; // Average percentage change
    topGainer: string; // Best performing symbol
    topLoser: string; // Worst performing symbol
  };
}

// ============================================================================
// Technical Indicator Types
// ============================================================================

/**
 * Configuration for which technical indicators to calculate
 */
export interface IndicatorConfig {
  sma?: number[]; // Array of SMA periods to calculate (e.g., [20, 50, 200])
  ema?: number[]; // Array of EMA periods to calculate (e.g., [12, 26])
  rsi?: number[]; // Array of RSI periods to calculate (e.g., [14])
}

/**
 * Single data point with OHLCV and calculated indicator values
 *
 * Each indicator type maps period numbers to their calculated values.
 * Null values indicate insufficient data to calculate the indicator at that point.
 */
export interface IndicatorDataPoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma: Record<number, number | null>; // period -> SMA value
  ema: Record<number, number | null>; // period -> EMA value
  rsi: Record<number, number | null>; // period -> RSI value
}

/**
 * Response structure for technical indicators endpoint
 *
 * Contains the requested indicators configuration and all calculated values
 * aligned with the OHLCV timestamps.
 */
export interface TechnicalIndicatorResponse {
  exchange: string;
  symbol: string;
  timeframe: Timeframe;
  marketType: 'spot' | 'perp';
  indicators: {
    sma: number[]; // SMA periods that were calculated
    ema: number[]; // EMA periods that were calculated
    rsi: number[]; // RSI periods that were calculated
  };
  data: IndicatorDataPoint[];
  candleCount: number;
}

/**
 * Default technical indicator periods commonly used in trading
 *
 * SMA Periods:
 * - 20: Short-term trend (about 1 month for daily candles)
 * - 50: Medium-term trend (about 2.5 months for daily candles)
 * - 200: Long-term trend (about 10 months for daily candles)
 *
 * EMA Periods:
 * - 9/12/21/26: Common MACD and short-term trading periods
 *
 * RSI Period:
 * - 14: Standard RSI period developed by J. Welles Wilder
 */
export const DEFAULT_INDICATOR_PERIODS = {
  sma: [20, 50, 200],
  ema: [9, 12, 21, 26],
  rsi: [14],
} as const;

/**
 * Indicator line configuration for chart overlays
 */
export interface IndicatorLine {
  type: 'sma' | 'ema';
  period: number;
  color: string;
  width?: number;
  visible: boolean;
}

/**
 * RSI panel configuration
 */
export interface RSIConfig {
  period: number;
  overbought: number; // Typically 70
  oversold: number; // Typically 30
  visible: boolean;
}

// ============================================================================
// Funding Rate Analytics Types
// ============================================================================

/**
 * Funding rate data for a single perpetual contract
 *
 * Funding rate is a periodic payment between long and short traders in perpetual futures.
 * - Positive rate: Longs pay shorts (bullish sentiment, more longs)
 * - Negative rate: Shorts pay longs (bearish sentiment, more shorts)
 *
 * Traders use funding rates for:
 * 1. Arbitrage: Earn passive income by going long spot + short perp when funding is positive
 * 2. Sentiment analysis: Extreme funding often precedes market reversals
 * 3. Cross-exchange arbitrage: Compare funding across exchanges
 */
export interface FundingRateData {
  symbol: string; // Trading pair symbol (e.g., BTCUSDT.P)
  baseAsset: string; // Base currency (e.g., BTC)
  exchange: string; // Exchange identifier
  fundingRate: number; // Current funding rate (e.g., 0.0001 = 0.01%)
  fundingRatePercent: number; // Funding rate as percentage (e.g., 0.01)
  annualizedRate: number; // Annualized rate assuming 3x daily (e.g., 10.95 for 0.01% * 3 * 365)
  nextFundingTime: number | null; // Timestamp of next funding settlement
  markPrice: number | null; // Current mark price
  indexPrice: number | null; // Current index (spot) price
  openInterest: number | null; // Open interest in USD
  volume24h: number | null; // 24h trading volume in USD
  timestamp: number; // Data timestamp
}

/**
 * Cross-exchange funding rate comparison for a single asset
 * Useful for identifying arbitrage opportunities
 */
export interface CrossExchangeFunding {
  baseAsset: string; // Base currency (e.g., BTC)
  rates: {
    exchange: string; // Exchange identifier
    symbol: string; // Symbol on that exchange
    fundingRate: number; // Current funding rate
    fundingRatePercent: number; // Funding rate as percentage
    annualizedRate: number; // Annualized rate
    markPrice: number | null; // Mark price on this exchange
  }[];
  spread: number; // Max - Min funding rate spread
  maxExchange: string; // Exchange with highest funding
  minExchange: string; // Exchange with lowest funding
  arbitrageOpportunity: boolean; // True if spread is significant (>0.02%)
}

/**
 * Funding rate sentiment indicator
 */
export type FundingSentiment =
  | 'extremely_bullish'
  | 'bullish'
  | 'neutral'
  | 'bearish'
  | 'extremely_bearish';

/**
 * Market funding statistics
 */
export interface FundingMarketStats {
  totalPairs: number; // Total perpetual pairs analyzed
  positiveCount: number; // Pairs with positive funding
  negativeCount: number; // Pairs with negative funding
  neutralCount: number; // Pairs with near-zero funding
  avgFundingRate: number; // Average funding rate across all pairs
  avgFundingPercent: number; // Average funding as percentage
  marketSentiment: FundingSentiment; // Overall market sentiment
  highestFunding: {
    symbol: string;
    rate: number;
    percent: number;
  };
  lowestFunding: {
    symbol: string;
    rate: number;
    percent: number;
  };
}

/**
 * Funding rate analytics response
 */
export interface FundingRateResponse {
  exchange: string; // Exchange identifier
  fundingRates: FundingRateData[]; // Array of funding rate data
  count: number; // Number of pairs returned
  stats: FundingMarketStats; // Market statistics
  timestamp: number; // Response timestamp
}

/**
 * Cross-exchange funding rate comparison response
 */
export interface CrossExchangeFundingResponse {
  comparisons: CrossExchangeFunding[]; // Cross-exchange comparisons
  count: number; // Number of assets compared
  exchanges: string[]; // Exchanges included in comparison
  timestamp: number; // Response timestamp
  arbitrageOpportunities: {
    // Top arbitrage opportunities
    asset: string;
    spread: number;
    longExchange: string; // Exchange to go long (low funding)
    shortExchange: string; // Exchange to go short (high funding)
    estimatedDailyYield: number; // Estimated daily yield from funding arbitrage
  }[];
}

// ============================================================================
// Real-time Engine, Order-flow, Backtesting, and Signal Lab Types
// ============================================================================

/** Current realtime wire-contract version. */
export const REALTIME_SCHEMA_VERSION = 1 as const;

export type RealtimeMarketType = 'spot' | 'perp';
export type RealtimePublicChannel =
  | 'ticker'
  | 'liquidations'
  | 'liquidation-bands'
  | 'trades'
  | 'cvd'
  | 'orderbook'
  | 'funding'
  | 'open-interest';

/**
 * Convert provider, CCXT, and Lazuli symbols into the single market identity
 * used by REST records, realtime topics, alert lookup, and persisted rollups.
 */
export function canonicalRealtimeSymbol(value: string, marketType: RealtimeMarketType): string {
  const upper = value.trim().toUpperCase();
  const withoutSettlement = upper.split(':')[0] ?? upper;
  const compact = withoutSettlement.replace(/\.P$/, '').replace(/[-_/]/g, '');
  if (!compact) return '';
  if (marketType === 'perp') return `${compact}.P`;

  const separated = withoutSettlement.replace(/\.P$/, '').match(/^([A-Z0-9]+)[-_/]([A-Z0-9]+)$/);
  if (separated?.[1] && separated[2]) return `${separated[1]}-${separated[2]}`;
  for (const quote of ['USDT', 'USDC', 'USD', 'KRW', 'BTC', 'ETH', 'EUR']) {
    if (compact.length > quote.length && compact.endsWith(quote)) {
      return `${compact.slice(0, -quote.length)}-${quote}`;
    }
  }
  return compact;
}

export function buildRealtimeTopic(
  channel: RealtimePublicChannel,
  exchange: SupportedExchange,
  symbol: string,
  marketType: RealtimeMarketType
): RealtimeTopic {
  return `${channel}:${exchange}:${canonicalRealtimeSymbol(symbol, marketType).toLowerCase()}` as RealtimeTopic;
}

/** Public and account-scoped topics accepted by the realtime broker. */
export type RealtimeTopic =
  | `ticker:${SupportedExchange}:${string}`
  | `liquidations:${SupportedExchange}:${string}`
  | `liquidation-bands:${SupportedExchange}:${string}`
  | `trades:${SupportedExchange}:${string}`
  | `cvd:${SupportedExchange}:${string}`
  | `orderbook:${SupportedExchange}:${string}`
  | `funding:${SupportedExchange}:${string}`
  | `open-interest:${SupportedExchange}:${string}`
  | `alerts:user:${string}`;

/** Provenance travels with every event so native, modeled, and fallback data cannot be confused. */
export interface RealtimeProvenance {
  kind: 'exchange-native' | 'modeled' | 'derived' | 'system';
  provider: string;
  quality: 'live' | 'snapshot' | 'fallback';
  upstreamSequence?: string | number;
}

/** Fields shared by all server-published realtime events. Timestamps are Unix milliseconds. */
export interface RealtimeEventBase<TType extends string, TTopic extends RealtimeTopic, TPayload> {
  schemaVersion: typeof REALTIME_SCHEMA_VERSION;
  type: TType;
  eventId: string;
  sequence: number;
  topic: TTopic;
  exchangeTimestamp: number;
  ingestedAt: number;
  publishedAt: number;
  provenance: RealtimeProvenance;
  payload: TPayload;
}

export interface RealtimeTickerPayload {
  exchange: SupportedExchange;
  symbol: string;
  marketType: 'spot' | 'perp';
  bid: number | null;
  ask: number | null;
  last: number | null;
  volume24h: number | null;
  change24hPercent: number | null;
}

export interface RealtimeLiquidationPrintPayload {
  exchange: SupportedExchange;
  symbol: string;
  side: 'long' | 'short';
  price: number;
  quantity: number;
  notionalUsd: number | null;
  orderId?: string;
}

export interface LiquidationPrint {
  eventId: string;
  sequence: number;
  exchangeTimestamp: number;
  ingestedAt: number;
  publishedAt: number;
  side: 'long' | 'short';
  price: number;
  quantity: number;
  notionalUsd: number | null;
  provenance: RealtimeProvenance;
}

export interface RealtimeLiquidationBandPayload {
  exchange: SupportedExchange;
  symbol: string;
  markPrice: number | null;
  levels: LiquidationLevel[];
}

export interface RealtimeTradePayload {
  exchange: SupportedExchange;
  symbol: string;
  tradeId: string;
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
}

export interface RealtimeCvdPayload {
  exchange: SupportedExchange;
  symbol: string;
  windowStart: number;
  windowEnd: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  cumulativeDelta: number;
}

export interface RealtimeOrderBookDeltaPayload {
  exchange: SupportedExchange;
  symbol: string;
  firstSequence: string | number | null;
  lastSequence: string | number | null;
  bids: Array<[price: number, quantity: number]>;
  asks: Array<[price: number, quantity: number]>;
  reset: boolean;
}

export interface RealtimeFundingPayload {
  exchange: SupportedExchange;
  symbol: string;
  fundingRate: number;
  nextFundingAt: number | null;
}

export interface RealtimeOpenInterestPayload {
  exchange: SupportedExchange;
  symbol: string;
  openInterest: number;
  openInterestUsd: number | null;
  change5mPercent: number | null;
  change1hPercent: number | null;
  change24hPercent: number | null;
}

export interface RealtimeAlertPayload {
  alertId: string | number;
  userId: string;
  exchange: SupportedExchange;
  symbol: string;
  condition: 'above' | 'below';
  targetPrice: number;
  triggerPrice: number;
  triggeredAt: number;
}

/**
 * Versioned discriminated event union used by ingestion, Durable Objects, and
 * browser consumers. Narrow on `type`; `topic` remains independently useful
 * for broker routing and sequence recovery.
 */
export type RealtimeEvent =
  | RealtimeEventBase<'ticker', `ticker:${SupportedExchange}:${string}`, RealtimeTickerPayload>
  | RealtimeEventBase<
      'liquidation-print',
      `liquidations:${SupportedExchange}:${string}`,
      RealtimeLiquidationPrintPayload
    >
  | RealtimeEventBase<
      'liquidation-bands',
      `liquidation-bands:${SupportedExchange}:${string}`,
      RealtimeLiquidationBandPayload
    >
  | RealtimeEventBase<'trade', `trades:${SupportedExchange}:${string}`, RealtimeTradePayload>
  | RealtimeEventBase<'cvd', `cvd:${SupportedExchange}:${string}`, RealtimeCvdPayload>
  | RealtimeEventBase<
      'orderbook-delta',
      `orderbook:${SupportedExchange}:${string}`,
      RealtimeOrderBookDeltaPayload
    >
  | RealtimeEventBase<'funding', `funding:${SupportedExchange}:${string}`, RealtimeFundingPayload>
  | RealtimeEventBase<
      'open-interest',
      `open-interest:${SupportedExchange}:${string}`,
      RealtimeOpenInterestPayload
    >
  | RealtimeEventBase<'alert', `alerts:user:${string}`, RealtimeAlertPayload>;

/** Browser-to-broker protocol messages. */
export type RealtimeClientMessage =
  | {
      type: 'subscribe';
      requestId: string;
      topics: RealtimeTopic[];
      token?: string;
      resumeFrom?: Partial<Record<RealtimeTopic, number>>;
    }
  | { type: 'unsubscribe'; requestId: string; topics: RealtimeTopic[] }
  | { type: 'ping'; requestId?: string; sentAt: number };

/** Broker-to-browser protocol messages. */
export type RealtimeServerMessage =
  | {
      type: 'ready';
      schemaVersion: typeof REALTIME_SCHEMA_VERSION;
      connectionId: string;
      heartbeatIntervalMs: number;
      serverTime: number;
    }
  | { type: 'subscribed'; requestId: string; topics: RealtimeTopic[] }
  | { type: 'unsubscribed'; requestId: string; topics: RealtimeTopic[] }
  | {
      type: 'event';
      topic: RealtimeTopic;
      sequence: number;
      event: RealtimeEvent;
      data: RealtimeEvent;
      publishedAt: number;
    }
  | {
      type: 'batch';
      schemaVersion: typeof REALTIME_SCHEMA_VERSION;
      topic: RealtimeTopic;
      firstSequence: number;
      lastSequence: number;
      events: Array<{
        type: 'event';
        topic: RealtimeTopic;
        sequence: number;
        event: RealtimeEvent;
        data: RealtimeEvent;
        publishedAt: number;
      }>;
      publishedAt: number;
    }
  | { type: 'heartbeat'; serverTime: number }
  | { type: 'pong'; requestId?: string; sentAt: number; serverTime: number }
  | {
      type: 'snapshot-required';
      topic: RealtimeTopic;
      expectedSequence: number;
      availableSequence: number;
    }
  | {
      type: 'error';
      requestId?: string;
      code:
        | 'invalid-message'
        | 'invalid-topic'
        | 'unauthorized'
        | 'rate-limited'
        | 'internal-error';
      message: string;
      retryable: boolean;
    };

/**
 * One modeled liquidation band around the current mark price.
 *
 * Public REST exchange APIs usually do not expose every liquidation print, so
 * Lazuli labels these rows as estimated and derives notional risk from mark
 * price, open interest, order-book proximity, and leverage assumptions.
 */
export interface LiquidationLevel {
  side: 'long' | 'short';
  leverage: number;
  price: number;
  distancePercent: number;
  estimatedNotionalUsd: number;
  intensity: number;
}

/**
 * Transparent liquidation radar response used by the workspace overlay and
 * future public realtime streams.
 */
export interface LiquidationRadarResponse {
  exchange: SupportedExchange;
  symbol: string;
  type: 'perp';
  markPrice: number | null;
  openInterestUsd: number | null;
  levels: LiquidationLevel[];
  /** Exchange-native observations kept separate from modeled bands. */
  nativePrints: LiquidationPrint[];
  nativeCoverage: {
    status: 'live' | 'empty' | 'unavailable';
    count: number;
    latestExchangeTimestamp: number | null;
    sequence: number | null;
  };
  heatmap: Array<{
    price: number;
    longIntensity: number;
    shortIntensity: number;
    totalEstimatedNotionalUsd: number;
  }>;
  cascades: Array<{
    side: 'long' | 'short';
    triggerPrice: number;
    estimatedNotionalUsd: number;
    severity: 'low' | 'medium' | 'high' | 'extreme';
    reason: string;
  }>;
  assumptions: {
    model: 'estimated-from-oi-mark-book';
    leverageBuckets: number[];
    maintenanceMarginRate: number;
  };
  timestamp: number;
}

/**
 * Per-candle order-flow proxy. Positive delta means close finished above open;
 * negative delta means sellers dominated the candle. This is deliberately a
 * proxy until exchange-native trade tape streams are wired into the Worker.
 */
export interface OrderFlowPoint {
  timestamp: number;
  price: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  cumulativeDelta: number;
  footprintImbalance: number;
}

/**
 * CVD and footprint response for chart overlays.
 */
export interface OrderFlowResponse {
  exchange: SupportedExchange;
  symbol: string;
  type: 'spot' | 'perp';
  timeframe: Timeframe;
  points: OrderFlowPoint[];
  summary: {
    cumulativeDelta: number;
    deltaPercentOfVolume: number;
    absorption: 'bid' | 'ask' | 'balanced';
    divergence: 'bullish' | 'bearish' | 'none';
  };
  timestamp: number;
}

/**
 * OI-weighted funding row used by the funding radar.
 */
export interface FundingRadarItem {
  symbol: string;
  baseAsset: string;
  exchange: string;
  fundingRatePercent: number;
  annualizedRate: number;
  openInterestUsd: number | null;
  volume24h: number | null;
  oiWeightedCarryUsd: number | null;
  pressure: 'longs-pay' | 'shorts-pay' | 'neutral';
  spikeScore: number;
  /** Observed open-interest changes from persisted venue samples; null until enough history exists. */
  change5mPercent: number | null;
  change1hPercent: number | null;
  change24hPercent: number | null;
  oiHistoryObservedAt: number | null;
}

/**
 * Funding and OI spike radar response.
 */
export interface FundingRadarResponse {
  items: FundingRadarItem[];
  count: number;
  stats: {
    totalOpenInterestUsd: number;
    oiWeightedAverageFundingPercent: number;
    positiveCarryUsd: number;
    negativeCarryUsd: number;
  };
  timestamp: number;
}

/**
 * Funding arbitrage quote adjusted for estimated execution costs and basis.
 */
export interface FundingArbitrageOpportunity {
  asset: string;
  longExchange: string;
  shortExchange: string;
  grossAnnualizedYield: number;
  estimatedExecutionCostBps: number;
  basisPercent: number;
  netAnnualizedYield: number;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Realistic funding arbitrage response that includes cost-adjusted yield.
 */
export interface FundingArbitrageResponse {
  opportunities: FundingArbitrageOpportunity[];
  count: number;
  timestamp: number;
}

/**
 * Minimal strategy definition for server-side Signal Lab and backtests.
 */
export interface StrategyDefinition {
  id?: string;
  name: string;
  mode: 'momentum' | 'mean-reversion' | 'breakout';
  fastPeriod: number;
  slowPeriod: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  feeBps: number;
}

/**
 * One historical backtest trade.
 */
export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  direction: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  pnlPercent: number;
  reason: string;
}

/**
 * Backtest response generated from OHLCV archive/live candles.
 */
export interface BacktestResponse {
  exchange: SupportedExchange;
  symbol: string;
  type: 'spot' | 'perp';
  timeframe: Timeframe;
  strategy: StrategyDefinition;
  metrics: {
    totalReturnPercent: number;
    maxDrawdownPercent: number;
    sharpe: number;
    winRate: number;
    tradeCount: number;
    profitFactor: number;
  };
  equityCurve: Array<{ timestamp: number; equity: number; drawdownPercent: number }>;
  trades: BacktestTrade[];
  timestamp: number;
}

/** Lifecycle state for a queued full-archive backtest. */
export type AsyncBacktestJobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';

/** Request body accepted by the authenticated full-archive backtest endpoint. */
export interface AsyncBacktestJobRequest {
  exchange: SupportedExchange;
  symbol: string;
  marketType: 'spot' | 'perp';
  timeframe: Timeframe;
  startTime: number;
  endTime: number;
  strategy: StrategyDefinition;
  strategyId?: string;
  savedBacktestId?: string;
  /** May also be supplied through the Idempotency-Key request header. */
  idempotencyKey?: string;
}

/** Compact result retained in D1; the complete curves and trades remain in R2. */
export interface AsyncBacktestResultSummary {
  metrics: BacktestResponse['metrics'];
  candleCount: number;
  equityPointCount: number;
  tradeCount: number;
  resultUrl: string;
}

/** Authenticated async backtest job state returned to its owner. */
export interface AsyncBacktestJob {
  id: string;
  status: AsyncBacktestJobStatus;
  exchange: SupportedExchange;
  symbol: string;
  marketType: 'spot' | 'perp';
  timeframe: Timeframe;
  startTime: number;
  endTime: number;
  progress: number;
  processedRows: number;
  totalRows: number | null;
  result: AsyncBacktestResultSummary | null;
  error: string | null;
  cancelRequestedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Persisted Signal Lab metadata. Storage is optional; when D1 is unavailable the
 * API can still return generated signals without persistence.
 */
export interface SignalLabStrategy {
  id: string;
  userId: string;
  name: string;
  exchange: SupportedExchange;
  symbol: string;
  marketType: 'spot' | 'perp';
  timeframe: Timeframe;
  strategy: StrategyDefinition;
  version: number;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  latestBacktest: BacktestResponse | null;
}

/**
 * Trending detector item comparing current 24h volume against a 7-day candle
 * baseline.
 */
export interface TrendingVolumeSpike {
  symbol: string;
  exchange: SupportedExchange;
  type: 'spot' | 'perp';
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
  sevenDayAverageVolume: number | null;
  volumeRatio24hVs7d: number | null;
  score: number;
}

/**
 * Discovery feed response for volume spikes and trend acceleration.
 */
export interface TrendingVolumeResponse {
  exchange: SupportedExchange;
  items: TrendingVolumeSpike[];
  count: number;
  timestamp: number;
}

// ============================================================================
// Order Book Types
// ============================================================================

/**
 * Single order in the order book
 * Represents a price level with quantity
 */
export interface OrderBookEntry {
  price: number; // Price level
  amount: number; // Quantity at this price
  total: number; // Cumulative total up to this level
}

/**
 * Order book data structure
 * Contains bid (buy) and ask (sell) orders sorted by price
 *
 * Bids are sorted from highest to lowest (best bid first)
 * Asks are sorted from lowest to highest (best ask first)
 */
export interface OrderBook {
  symbol: string; // Trading pair symbol (e.g., BTC-USDT or BTCUSDT.P)
  exchange: string; // Exchange identifier
  type: 'spot' | 'perp'; // Market type
  bids: OrderBookEntry[]; // Buy orders (highest price first)
  asks: OrderBookEntry[]; // Sell orders (lowest price first)
  timestamp: number; // Data timestamp
  nonce?: number; // Exchange-specific sequence number (if available)
}

/**
 * Order book response from /orderbook/:exchange/:symbol
 */
export interface OrderBookResponse {
  exchange: string; // Exchange identifier
  symbol: string; // Trading pair symbol
  type: 'spot' | 'perp'; // Market type
  orderbook: OrderBook; // Order book data
  depth: number; // Number of price levels returned
  spread: number | null; // Bid-ask spread in price units
  spreadPercent: number | null; // Bid-ask spread as percentage
  midPrice: number | null; // Mid-market price
  timestamp: number; // Response timestamp
}

// ============================================================================
// Institutional Intelligence Types
// ============================================================================

/**
 * Institutional assets supported by the v1 suite.
 * BTC and ETH have the deepest ETF and listed-options data coverage.
 */
export type InstitutionalAsset = 'BTC' | 'ETH';

/**
 * Time ranges used by ETF and volatility history endpoints.
 */
export type InstitutionalRange = '30d' | '90d' | 'ytd' | 'all';

/**
 * Status metadata for each upstream data source. Panels can degrade
 * independently when one public provider changes format or rate-limits.
 */
export interface InstitutionalProviderStatus {
  provider: string;
  source: 'live' | 'snapshot' | 'fallback';
  ok: boolean;
  updatedAt: number;
  stale: boolean;
  message?: string;
}

/**
 * Spot ETF product metadata.
 */
export interface EtfFund {
  ticker: string;
  name: string;
  issuer: string;
  asset: InstitutionalAsset;
  category: 'spot';
  firstSeen: string | null;
  cumulativeFlowUsd: number;
  latestFlowUsd: number | null;
}

/**
 * One daily ETF flow observation. Fund-level flows are expressed in USD.
 */
export interface EtfDailyFlow {
  date: string;
  asset: InstitutionalAsset;
  totalNetFlowUsd: number;
  cumulativeNetFlowUsd: number;
  fundFlows: Record<string, number | null>;
  leaderTicker: string | null;
  laggardTicker: string | null;
  anomaly: boolean;
}

/**
 * Consecutive ETF flow streak. Direction is based on aggregate daily net flow.
 */
export interface EtfFlowStreak {
  direction: 'inflow' | 'outflow' | 'flat';
  days: number;
  totalUsd: number;
  averageUsd: number;
}

/**
 * ETF flow response for charting and table views.
 */
export interface EtfFlowResponse {
  asset: InstitutionalAsset;
  range: InstitutionalRange;
  flows: EtfDailyFlow[];
  funds: EtfFund[];
  latest: EtfDailyFlow | null;
  streak: EtfFlowStreak;
  totals: {
    netFlowUsd: number;
    cumulativeNetFlowUsd: number;
    averageDailyFlowUsd: number;
    positiveDays: number;
    negativeDays: number;
    anomalyDays: number;
  };
  provider: InstitutionalProviderStatus;
  timestamp: number;
}

/**
 * Fund-only ETF response for product comparison tables.
 */
export interface EtfFundsResponse {
  asset: InstitutionalAsset;
  funds: EtfFund[];
  provider: InstitutionalProviderStatus;
  timestamp: number;
}

/**
 * Deribit option instrument normalized for the frontend.
 */
export interface OptionInstrument {
  instrumentName: string;
  asset: InstitutionalAsset;
  expiry: string;
  expiryTimestamp: number;
  strike: number;
  optionType: 'call' | 'put';
  bid: number | null;
  ask: number | null;
  markPrice: number | null;
  underlyingPrice: number | null;
  openInterest: number;
  volume24h: number;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

/**
 * Open-interest concentration by strike for one expiry.
 */
export interface OptionStrikeSummary {
  strike: number;
  callOpenInterest: number;
  putOpenInterest: number;
  totalOpenInterest: number;
  callVolume24h: number;
  putVolume24h: number;
  netCallPutOpenInterest: number;
}

/**
 * Per-expiry summary used by the options board and confluence engine.
 */
export interface OptionExpirySummary {
  expiry: string;
  expiryTimestamp: number;
  daysToExpiry: number;
  instrumentCount: number;
  totalOpenInterest: number;
  totalVolume24h: number;
  callOpenInterest: number;
  putOpenInterest: number;
  putCallRatio: number;
  maxPainStrike: number | null;
  largestCallWall: OptionStrikeSummary | null;
  largestPutWall: OptionStrikeSummary | null;
  atmImpliedVolatility: number | null;
  skew25Delta: number | null;
}

/**
 * Implied volatility index candle from Deribit volatility index data.
 */
export interface VolatilityCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Options chain response for one expiry.
 */
export interface OptionsChainResponse {
  asset: InstitutionalAsset;
  expiry: string | null;
  expiries: OptionExpirySummary[];
  chain: OptionInstrument[];
  strikes: OptionStrikeSummary[];
  provider: InstitutionalProviderStatus;
  timestamp: number;
}

/**
 * Available options expiries response.
 */
export interface OptionsExpiriesResponse {
  asset: InstitutionalAsset;
  expiries: OptionExpirySummary[];
  provider: InstitutionalProviderStatus;
  timestamp: number;
}

/**
 * Volatility history response for IV regime charts.
 */
export interface OptionsVolatilityResponse {
  asset: InstitutionalAsset;
  range: InstitutionalRange;
  candles: VolatilityCandle[];
  current: number | null;
  rank: number | null;
  provider: InstitutionalProviderStatus;
  timestamp: number;
}

/** Quality state for one observed side of an options IV surface cell. */
export type OptionIvQuality = 'observed' | 'illiquid' | 'missing';

/**
 * One strike/expiry cell in the observed implied-volatility surface. Values are
 * never interpolated: a null value and `missing` mask means the venue did not
 * publish a usable observation for that side.
 */
export interface OptionIvSurfacePoint {
  expiry: string;
  expiryTimestamp: number;
  daysToExpiry: number;
  strike: number;
  callIv: number | null;
  putIv: number | null;
  callDelta: number | null;
  putDelta: number | null;
  callOpenInterest: number;
  putOpenInterest: number;
  qualityMask: {
    call: OptionIvQuality;
    put: OptionIvQuality;
  };
}

/** Observed ATM term-structure point derived from the nearest listed strike. */
export interface OptionIvTermStructurePoint {
  expiry: string;
  expiryTimestamp: number;
  daysToExpiry: number;
  atmImpliedVolatility: number | null;
  sourceStrike: number | null;
  strikeDistancePercent: number | null;
  skew25Delta: number | null;
  quality: OptionIvQuality;
}

/** Full observed IV surface with explicit coverage and data-quality metadata. */
export interface OptionsSurfaceResponse {
  asset: InstitutionalAsset;
  underlyingPrice: number | null;
  points: OptionIvSurfacePoint[];
  termStructure: OptionIvTermStructurePoint[];
  expiries: OptionExpirySummary[];
  quality: {
    observedSides: number;
    illiquidSides: number;
    missingSides: number;
    coveragePercent: number;
    methodology: 'observed-only';
  };
  provider: InstitutionalProviderStatus;
  timestamp: number;
}

/** Macro series identifiers used by the confluence engine. */
export type MacroMetric = 'btcDominance' | 'stablecoinSupplyUsd' | 'fearGreedIndex';

/** One normalized macro observation. */
export interface MacroHistoryPoint {
  observedAt: number;
  value: number;
}

/** A macro series whose provider health degrades independently of its peers. */
export interface MacroHistorySeries {
  metric: MacroMetric;
  unit: 'percent' | 'usd' | 'index';
  points: MacroHistoryPoint[];
  latest: MacroHistoryPoint | null;
  provider: InstitutionalProviderStatus;
}

/** BTC dominance, stablecoin supply, and sentiment history for confluence. */
export interface MacroHistoryResponse {
  range: InstitutionalRange;
  series: {
    btcDominance: MacroHistorySeries;
    stablecoinSupplyUsd: MacroHistorySeries;
    fearGreedIndex: MacroHistorySeries;
  };
  providers: InstitutionalProviderStatus[];
  timestamp: number;
}

/**
 * Single transparent signal feeding the institutional regime score.
 */
export interface ConfluenceSignal {
  id:
    | 'etfDemand'
    | 'optionsSkew'
    | 'perpLeverage'
    | 'basisStress'
    | 'spotTrend'
    | 'liquidityRisk'
    | 'btcDominance'
    | 'stablecoinLiquidity'
    | 'fearGreed';
  label: string;
  score: number;
  direction: 'bullish' | 'bearish' | 'neutral' | 'risk';
  value: string;
  explanation: string;
  fresh: boolean;
}

/**
 * Composite market-regime readout.
 */
export interface InstitutionalConfluenceResponse {
  asset: InstitutionalAsset;
  regime: 'spot-led' | 'etf-led' | 'options-led' | 'leverage-led' | 'fragile' | 'mixed';
  regimeScore: number;
  confidence: number;
  summary: string;
  signals: ConfluenceSignal[];
  providers: InstitutionalProviderStatus[];
  timestamp: number;
}

/**
 * Flagship overview response powering Flow & Vol Radar.
 */
export interface InstitutionalOverviewResponse {
  asset: InstitutionalAsset;
  price: {
    spot: number | null;
    change24h: number | null;
    sourceExchange: SupportedExchange;
  };
  etf: {
    latestFlowUsd: number | null;
    cumulativeFlowUsd: number | null;
    streak: EtfFlowStreak;
  };
  options: {
    currentIv: number | null;
    ivRank: number | null;
    skew25Delta: number | null;
    nearestExpiry: OptionExpirySummary | null;
    largestExpiryWall: OptionStrikeSummary | null;
  };
  derivatives: {
    avgFundingRate: number | null;
    totalOpenInterestUsd: number | null;
    fundingPressure: 'longs-pay' | 'shorts-pay' | 'neutral';
  };
  confluence: InstitutionalConfluenceResponse;
  providers: InstitutionalProviderStatus[];
  timestamp: number;
}
