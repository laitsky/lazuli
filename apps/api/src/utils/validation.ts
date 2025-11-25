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
  const str = String(value);

  // Parse as base-10 integer
  const parsed = parseInt(str, 10);

  // Check if parsing was successful and value is within bounds
  if (isNaN(parsed) || !isFinite(parsed) || parsed < min || parsed > max) {
    return defaultValue;
  }

  return parsed;
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
    return undefined;
  }

  // Convert to string and trim
  const str = String(value).trim().toLowerCase();

  // Check length
  if (str.length === 0 || str.length > maxLength) {
    return undefined;
  }

  // Allow only alphanumeric characters, spaces, hyphens, forward slashes, and periods
  // This is safe for crypto trading pairs like BTC/USDT, BTC-USDT, BTCUSDT.P
  const validPattern = /^[a-z0-9\s\-\/.]+$/i;
  if (!validPattern.test(str)) {
    return undefined;
  }

  return str;
}

/**
 * Validate market type filter
 * @param value - Input value
 * @returns 'spot', 'perp', or undefined if invalid
 */
export function validateMarketType(value: any): 'spot' | 'perp' | undefined {
  if (value === 'spot' || value === 'perp') {
    return value;
  }
  return undefined;
}

/**
 * Validate sort order
 * @param value - Input value
 * @returns 'asc' or 'desc', defaults to 'desc'
 */
export function validateSortOrder(value: any): 'asc' | 'desc' {
  if (value === 'asc') {
    return 'asc';
  }
  return 'desc'; // Default to descending
}

/**
 * Validate sort field for tickers
 * @param value - Input value
 * @returns Valid sort field or 'volume' as default
 */
export function validateTickerSortBy(value: any): 'volume' | 'price' | 'change' {
  if (value === 'volume' || value === 'price' || value === 'change') {
    return value;
  }
  return 'volume'; // Default to volume
}

/**
 * Validate boolean value
 * @param value - Input value
 * @returns true, false, or undefined
 */
export function validateBoolean(value: any): boolean | undefined {
  if (value === 'true' || value === true) {
    return true;
  }
  if (value === 'false' || value === false) {
    return false;
  }
  return undefined;
}

/**
 * Validate quote currency filter
 * Allows filtering tickers by quote currency (e.g., USDT, BTC, ETH)
 *
 * @param value - Input value
 * @returns Uppercase quote currency or undefined if invalid
 */
export function validateQuoteCurrency(value: any): string | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  // Convert to string, trim, and uppercase
  const str = String(value).trim().toUpperCase();

  // Check length (quote currencies are typically 3-5 characters)
  if (str.length < 2 || str.length > 10) {
    return undefined;
  }

  // Allow only alphanumeric characters
  const validPattern = /^[A-Z0-9]+$/;
  if (!validPattern.test(str)) {
    return undefined;
  }

  return str;
}

/**
 * Validate exchange ID
 * @param value - Input value
 * @returns Valid exchange ID or null
 */
export function validateExchange(value: any): 'binance' | 'bybit' | 'okx' | 'hyperliquid' | null {
  const normalized = String(value).toLowerCase();

  if (normalized === 'binance' || normalized === 'bybit' || normalized === 'okx' || normalized === 'hyperliquid') {
    return normalized as 'binance' | 'bybit' | 'okx' | 'hyperliquid';
  }

  return null;
}

/**
 * Convert CCXT symbol notation to our standardized notation
 *
 * CCXT uses:
 * - Spot: BTC/USDT
 * - Perpetual: BTC/USDT:USDT (redundant settlement currency)
 *
 * We standardize to:
 * - Spot: BTC-USDT (hyphen separator)
 * - Perpetual: BTCUSDT.P (combined with .P suffix)
 *
 * @param ccxtSymbol - Symbol in CCXT format (e.g., "BTC/USDT" or "BTC/USDT:USDT")
 * @param marketType - Market type ('spot' or 'perp')
 * @returns Standardized symbol notation
 *
 * @example
 * convertFromCCXTNotation('BTC/USDT', 'spot') // Returns: 'BTC-USDT'
 * convertFromCCXTNotation('BTC/USDT:USDT', 'perp') // Returns: 'BTCUSDT.P'
 * convertFromCCXTNotation('ETH/BTC', 'spot') // Returns: 'ETH-BTC'
 */
export function convertFromCCXTNotation(ccxtSymbol: string, marketType: 'spot' | 'perp'): string {
  if (marketType === 'spot') {
    // Spot: Convert BTC/USDT to BTC-USDT
    return ccxtSymbol.replace('/', '-');
  } else {
    // Perpetual: Convert BTC/USDT:USDT to BTCUSDT.P
    // Remove the settlement currency (after colon) and the separators
    const baseQuote = ccxtSymbol.split(':')[0]; // Get "BTC/USDT" from "BTC/USDT:USDT"
    const combined = baseQuote.replace('/', ''); // Combine to "BTCUSDT"
    return `${combined}.P`; // Add .P suffix for perpetual
  }
}

/**
 * Convert our standardized notation back to CCXT symbol format
 * This is needed when making API calls to exchanges via CCXT
 *
 * Our notation:
 * - Spot: BTC-USDT
 * - Perpetual: BTCUSDT.P
 *
 * CCXT expects:
 * - Spot: BTC/USDT
 * - Perpetual: BTC/USDT:USDT
 *
 * @param standardSymbol - Symbol in our standard notation
 * @param marketType - Market type ('spot' or 'perp')
 * @returns CCXT-compatible symbol
 *
 * @example
 * convertToCCXTNotation('BTC-USDT', 'spot') // Returns: 'BTC/USDT'
 * convertToCCXTNotation('BTCUSDT.P', 'perp') // Returns: 'BTC/USDT:USDT'
 */
export function convertToCCXTNotation(standardSymbol: string, marketType: 'spot' | 'perp'): string {
  if (marketType === 'spot') {
    // Spot: Convert BTC-USDT to BTC/USDT
    return standardSymbol.replace('-', '/');
  } else {
    // Perpetual: Convert BTCUSDT.P to BTC/USDT:USDT
    const baseQuote = standardSymbol.replace('.P', ''); // Remove .P suffix

    // Need to split the combined symbol (BTCUSDT) into base and quote
    // Common quote currencies to check (in order of likelihood)
    const commonQuotes = [
      'USDT',
      'USDC',
      'BUSD',
      'USD',
      'BTC',
      'ETH',
      'BNB',
      'TUSD',
      'DAI',
      'FDUSD',
    ];

    for (const quote of commonQuotes) {
      if (baseQuote.endsWith(quote)) {
        const base = baseQuote.slice(0, -quote.length);
        return `${base}/${quote}:${quote}`;
      }
    }

    // Fallback: If we can't parse it, return as-is with warning
    console.warn(`Unable to parse perpetual symbol: ${standardSymbol}`);
    return standardSymbol.replace('.P', '');
  }
}

/**
 * Parse a symbol to extract base and quote currencies
 * Works with both our standardized notation and CCXT notation
 *
 * @param symbol - Symbol in any supported format
 * @returns Object with base and quote currencies
 *
 * @example
 * parseSymbol('BTC-USDT') // Returns: { base: 'BTC', quote: 'USDT' }
 * parseSymbol('BTCUSDT.P') // Returns: { base: 'BTC', quote: 'USDT' }
 * parseSymbol('BTC/USDT') // Returns: { base: 'BTC', quote: 'USDT' }
 */
export function parseSymbol(symbol: string): { base: string; quote: string } {
  // Handle our perpetual notation (BTCUSDT.P)
  if (symbol.endsWith('.P')) {
    const baseQuote = symbol.replace('.P', '');
    const commonQuotes = [
      'USDT',
      'USDC',
      'BUSD',
      'USD',
      'BTC',
      'ETH',
      'BNB',
      'TUSD',
      'DAI',
      'FDUSD',
    ];

    for (const quote of commonQuotes) {
      if (baseQuote.endsWith(quote)) {
        const base = baseQuote.slice(0, -quote.length);
        return { base, quote };
      }
    }
  }

  // Handle standard separators (-, /, :)
  const separator = symbol.match(/[-/:]/)?.[0];

  if (separator) {
    const [base, quote] = symbol.split(separator);
    return { base: base || '', quote: quote?.split(':')[0] || '' };
  }

  // Fallback: return the whole symbol as base
  return { base: symbol, quote: '' };
}
