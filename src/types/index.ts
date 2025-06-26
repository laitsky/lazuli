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
export type SupportedExchange = 'binance' | 'bybit' | 'okx' | 'hyperliquid';