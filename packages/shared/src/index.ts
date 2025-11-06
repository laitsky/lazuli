/**
 * Shared types and interfaces between API and Web applications
 * This package provides type safety across the full stack
 */

/**
 * Standard API response wrapper for all endpoints
 */
export interface ApiResponse<T = any> {
  success: boolean
  data: T
  error: string | null
  timestamp: number
}

/**
 * Ticker data structure (cryptocurrency market data)
 */
export interface Ticker {
  symbol: string                    // Trading pair symbol (e.g., BTC/USDT)
  exchange: string                  // Exchange identifier
  type: 'spot' | 'perp'            // Market type
  bid: number | null                // Highest bid price
  ask: number | null                // Lowest ask price
  last: number | null               // Last traded price
  high24h: number | null            // 24h highest price
  low24h: number | null             // 24h lowest price
  volume24h: number | null          // 24h base volume
  quoteVolume24h: number | null    // 24h quote volume
  change24h: number | null          // 24h absolute change
  percentage24h: number | null      // 24h percentage change
  timestamp: number                 // Data timestamp
  fundingRate?: number | null       // Perpetual funding rate (perp only)
  openInterest?: number | null      // Perpetual open interest (perp only)
}

/**
 * Market information structure
 */
export interface Market {
  id: string                        // Market identifier
  symbol: string                    // Trading pair symbol
  base: string                      // Base currency
  quote: string                     // Quote currency
  type: 'spot' | 'perp'            // Market type
  active: boolean                   // Is market active
  exchange: string                  // Exchange identifier
}

/**
 * Exchange capabilities information
 */
export interface ExchangeInfo {
  name: string                      // Display name
  id: string                        // Exchange identifier
  supported: boolean                // Is supported
  hasSpot: boolean                  // Has spot markets
  hasPerp: boolean                  // Has perpetual markets
}

/**
 * Supported exchanges
 */
export type SupportedExchange = 'binance' | 'bybit' | 'okx' | 'hyperliquid'

/**
 * Tickers response from /tickers/:exchange
 */
export interface TickersResponse {
  exchange: string
  tickers: Ticker[]
  count: number
}

/**
 * Markets response from /markets/:exchange
 */
export interface MarketsResponse {
  exchange: string
  markets: Market[]
  count: number
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: string
  api: string
  database: string
  exchanges: string[]
  timestamp: number
}
