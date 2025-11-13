/**
 * API Client for Lazuli Backend
 * Handles all communication with the backend REST API
 */

import {
  ApiResponse,
  ExchangeInfo,
  Ticker,
  TickersResponse,
  Market,
  MarketsResponse,
  HealthResponse,
  SupportedExchange,
  OHLCVResponse,
  CustomPairResponse,
  Timeframe,
} from '@lazuli/shared'

// API base URL - defaults to localhost in development
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
const API_VERSION = '/api/v1'

// Default timeout for API requests (30 seconds)
const DEFAULT_TIMEOUT = 30000

/**
 * Query parameters for tickers endpoint
 */
export interface TickersQueryParams {
  page?: number
  limit?: number
  type?: 'spot' | 'perp'
  search?: string
  sortBy?: 'volume' | 'price' | 'change'
  sortOrder?: 'asc' | 'desc'
}

/**
 * Query parameters for markets endpoint
 */
export interface MarketsQueryParams {
  page?: number
  limit?: number
  type?: 'spot' | 'perp'
  search?: string
  active?: boolean
}

/**
 * Query parameters for OHLCV endpoint
 */
export interface OHLCVQueryParams {
  timeframe: Timeframe
  type?: 'spot' | 'perp'
  limit?: number
}

/**
 * Query parameters for multi-timeframe OHLCV endpoint
 */
export interface MultiTimeframeOHLCVQueryParams {
  timeframes: Timeframe[]
  type?: 'spot' | 'perp'
  limit?: number
}

/**
 * Query parameters for custom pair endpoint
 */
export interface CustomPairQueryParams {
  timeframe: Timeframe
  type?: 'spot' | 'perp'
  limit?: number
}

/**
 * Build query string from parameters
 */
function buildQueryString(params?: Record<string, any>): string {
  if (!params) return ''

  const queryParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value))
    }
  })

  const queryString = queryParams.toString()
  return queryString ? `?${queryString}` : ''
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
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`)
    }
    throw error
  }
}

/**
 * Base fetch wrapper with error handling and timeout support
 */
async function apiFetch<T>(endpoint: string, queryParams?: Record<string, any>, timeout?: number): Promise<ApiResponse<T>> {
  try {
    const queryString = buildQueryString(queryParams)
    const response = await fetchWithTimeout(
      `${API_BASE_URL}${endpoint}${queryString}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        // Disable caching for real-time data
        cache: 'no-store',
      },
      timeout
    )

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data: ApiResponse<T> = await response.json()
    return data
  } catch (error) {
    // Return error in standard API response format
    return {
      success: false,
      data: null as T,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: Date.now(),
    }
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
    return apiFetch<ExchangeInfo[]>(`${API_VERSION}/exchanges`)
  }

  /**
   * Get all tickers for a specific exchange with optional filtering and pagination
   */
  static async getTickers(
    exchange: SupportedExchange,
    queryParams?: TickersQueryParams
  ): Promise<ApiResponse<TickersResponse>> {
    return apiFetch<TickersResponse>(`${API_VERSION}/tickers/${exchange}`, queryParams)
  }

  /**
   * Get ticker data for a specific symbol on an exchange
   */
  static async getTicker(
    exchange: SupportedExchange,
    symbol: string
  ): Promise<ApiResponse<Ticker>> {
    // URL encode the symbol to handle special characters like /
    const encodedSymbol = encodeURIComponent(symbol)
    return apiFetch<Ticker>(`${API_VERSION}/tickers/${exchange}/${encodedSymbol}`)
  }

  /**
   * Get all markets for a specific exchange with optional filtering and pagination
   */
  static async getMarkets(
    exchange: SupportedExchange,
    queryParams?: MarketsQueryParams
  ): Promise<ApiResponse<MarketsResponse>> {
    return apiFetch<MarketsResponse>(`${API_VERSION}/markets/${exchange}`, queryParams)
  }

  /**
   * Health check - get API status
   */
  static async getHealth(): Promise<ApiResponse<HealthResponse>> {
    return apiFetch<HealthResponse>('/health')
  }

  /**
   * Get OHLCV (candlestick) data for a specific symbol and timeframe
   */
  static async getOHLCV(
    exchange: SupportedExchange,
    symbol: string,
    queryParams: OHLCVQueryParams
  ): Promise<ApiResponse<OHLCVResponse>> {
    const encodedSymbol = encodeURIComponent(symbol)
    return apiFetch<OHLCVResponse>(`${API_VERSION}/ohlcv/${exchange}/${encodedSymbol}`, queryParams)
  }

  /**
   * Get OHLCV data for multiple timeframes at once
   */
  static async getMultiTimeframeOHLCV(
    exchange: SupportedExchange,
    symbol: string,
    queryParams: MultiTimeframeOHLCVQueryParams
  ): Promise<ApiResponse<any>> {
    const encodedSymbol = encodeURIComponent(symbol)
    // Convert timeframes array to comma-separated string
    const params = {
      ...queryParams,
      timeframes: queryParams.timeframes.join(','),
    }
    return apiFetch<any>(`${API_VERSION}/ohlcv/multi/${exchange}/${encodedSymbol}`, params)
  }

  /**
   * Generate custom pair OHLCV data by dividing two ticker prices
   * Example: BTC-USDT / AVAX-USDT = BTC/AVAX custom pair
   * Uses extended timeout (60s) as it fetches data for two symbols
   */
  static async getCustomPair(
    exchange: SupportedExchange,
    symbol1: string,
    symbol2: string,
    queryParams: CustomPairQueryParams
  ): Promise<ApiResponse<CustomPairResponse>> {
    const encodedSymbol1 = encodeURIComponent(symbol1)
    const encodedSymbol2 = encodeURIComponent(symbol2)
    // Use 60s timeout for custom pair (fetches 2 symbols + calculation)
    return apiFetch<CustomPairResponse>(
      `${API_VERSION}/custom-pair/${exchange}/${encodedSymbol1}/${encodedSymbol2}`,
      queryParams,
      60000
    )
  }
}

/**
 * Utility functions for working with API data
 */

/**
 * Format a number as USD currency
 */
export function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Format a large number with K/M/B suffixes
 * @param value - The numeric value to format
 * @param currency - Optional currency code to display (e.g., 'USDT', 'BTC', 'IDRT')
 * @returns Formatted string with K/M/B suffix and optional currency
 */
export function formatVolume(value: number | null, currency?: string): string {
  if (value === null) return 'N/A'

  let formatted: string
  if (value >= 1e9) {
    formatted = `${(value / 1e9).toFixed(2)}B`
  } else if (value >= 1e6) {
    formatted = `${(value / 1e6).toFixed(2)}M`
  } else if (value >= 1e3) {
    formatted = `${(value / 1e3).toFixed(2)}K`
  } else {
    formatted = value.toFixed(2)
  }

  // If currency is provided, append it; otherwise return just the number
  return currency ? `${formatted} ${currency}` : formatted
}

/**
 * Format percentage change with + or - sign
 */
export function formatPercentage(value: number | null): string {
  if (value === null) return 'N/A'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

/**
 * Get color class based on percentage change (for styling)
 */
export function getChangeColor(value: number | null): string {
  if (value === null) return 'text-muted-foreground'
  if (value > 0) return 'text-green-600 dark:text-green-400'
  if (value < 0) return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

/**
 * Format timestamp to readable date/time
 */
export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}
