/**
 * Input validation utilities for API endpoints
 * Ensures safe and proper handling of user input
 */

/**
 * Validate and parse an integer from user input
 * Returns default value if input is invalid
 *
 * @param value - Input value to validate
 * @param defaultValue - Default value if input is invalid
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Validated integer within bounds
 */
export function validateInteger(
  value: any,
  defaultValue: number,
  min: number,
  max: number
): number {
  // Convert to string first to handle various input types safely
  const str = String(value)

  // Parse as base-10 integer
  const parsed = parseInt(str, 10)

  // Check if parsing was successful and value is within bounds
  if (isNaN(parsed) || !isFinite(parsed) || parsed < min || parsed > max) {
    return defaultValue
  }

  return parsed
}

/**
 * Validate and sanitize a search query string
 * Protects against injection attacks and limits length
 *
 * @param value - Input search query
 * @param maxLength - Maximum allowed length (default: 50)
 * @returns Sanitized search query or undefined if invalid
 */
export function validateSearchQuery(value: any, maxLength: number = 50): string | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined
  }

  // Convert to string and trim
  const str = String(value).trim().toLowerCase()

  // Check length
  if (str.length === 0 || str.length > maxLength) {
    return undefined
  }

  // Allow only alphanumeric characters, spaces, hyphens, and forward slashes
  // This is safe for crypto trading pairs like BTC/USDT, BTC-USDT
  const validPattern = /^[a-z0-9\s\-\/]+$/i
  if (!validPattern.test(str)) {
    return undefined
  }

  return str
}

/**
 * Validate market type filter
 * @param value - Input value
 * @returns 'spot', 'perp', or undefined if invalid
 */
export function validateMarketType(value: any): 'spot' | 'perp' | undefined {
  if (value === 'spot' || value === 'perp') {
    return value
  }
  return undefined
}

/**
 * Validate sort order
 * @param value - Input value
 * @returns 'asc' or 'desc', defaults to 'desc'
 */
export function validateSortOrder(value: any): 'asc' | 'desc' {
  if (value === 'asc') {
    return 'asc'
  }
  return 'desc' // Default to descending
}

/**
 * Validate sort field for tickers
 * @param value - Input value
 * @returns Valid sort field or 'volume' as default
 */
export function validateTickerSortBy(value: any): 'volume' | 'price' | 'change' {
  if (value === 'volume' || value === 'price' || value === 'change') {
    return value
  }
  return 'volume' // Default to volume
}

/**
 * Validate boolean value
 * @param value - Input value
 * @returns true, false, or undefined
 */
export function validateBoolean(value: any): boolean | undefined {
  if (value === 'true' || value === true) {
    return true
  }
  if (value === 'false' || value === false) {
    return false
  }
  return undefined
}

/**
 * Validate exchange ID
 * @param value - Input value
 * @returns Valid exchange ID or null
 */
export function validateExchange(value: any): 'binance' | 'bybit' | 'okx' | 'hyperliquid' | null {
  const normalized = String(value).toLowerCase()

  if (
    normalized === 'binance' ||
    normalized === 'bybit' ||
    normalized === 'okx' ||
    normalized === 'hyperliquid'
  ) {
    return normalized as 'binance' | 'bybit' | 'okx' | 'hyperliquid'
  }

  return null
}
