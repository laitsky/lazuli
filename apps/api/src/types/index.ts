/**
 * Standard API response format for all endpoints
 * Ensures consistent response structure across the application
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  error: string | null;
  timestamp: number;
}

/**
 * Ticker data structure representing cryptocurrency market data
 * Used for both spot and perpetual futures markets
 */
export interface Ticker {
  symbol: string;
  exchange: string;
  type: 'spot' | 'perp';
  bid: number | null;
  ask: number | null;
  last: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  quoteVolume24h: number | null;
  change24h: number | null;
  percentage24h: number | null;
  timestamp: number;
  fundingRate?: number | null;
  openInterest?: number | null;
}

/**
 * Market information structure
 * Describes available trading pairs on exchanges
 */
export interface Market {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  type: 'spot' | 'perp';
  active: boolean;
  exchange: string;
}

/**
 * Exchange information and capabilities
 * Describes what markets each exchange supports
 */
export interface ExchangeInfo {
  name: string;
  id: string;
  supported: boolean;
  hasSpot: boolean;
  hasPerp: boolean;
}

/**
 * Supported exchange identifiers
 * Add new exchanges here when implementing additional integrations
 */
export type SupportedExchange = 'binance' | 'bybit' | 'okx';

/**
 * OHLCV candlestick data (Open, High, Low, Close, Volume)
 * Standard format for chart data across all timeframes
 */
export interface OHLCV {
  timestamp: number;     // Candle start timestamp in milliseconds
  open: number;          // Opening price
  high: number;          // Highest price in the period
  low: number;           // Lowest price in the period
  close: number;         // Closing price
  volume: number;        // Trading volume in base currency
}

/**
 * Supported timeframes for OHLCV data
 * Maps to standard exchange timeframe formats
 */
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '3d' | '1w';

/**
 * OHLCV response from /ohlcv/:exchange/:symbol
 */
export interface OHLCVResponse {
  exchange: string;        // Exchange identifier
  symbol: string;          // Trading pair symbol
  timeframe: Timeframe;    // Requested timeframe
  candles: OHLCV[];       // Array of candlestick data
  count: number;          // Number of candles returned
}