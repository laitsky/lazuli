/**
 * Price formatting utilities for cryptocurrency trading data
 *
 * Handles dynamic decimal precision for prices ranging from
 * high-value assets (BTC ~$100k) to micro-cap tokens (0.00000001)
 *
 * Industry Standard References:
 * - CoinGecko: Uses 2-8 decimals based on price magnitude
 * - Binance: Uses dynamic precision based on tick size
 * - TradingView: Supports custom formatters for price display
 */

/**
 * Calculate the appropriate number of decimal places for a price
 *
 * Logic:
 * - Prices >= 1000: 2 decimals (e.g., BTC: $98,234.56)
 * - Prices >= 1: 4 decimals (e.g., SOL: $123.4567)
 * - Prices < 1: Leading zeros + 4 significant digits (max 12)
 *   e.g., 0.00001234 -> 8 decimals to show "0.00001234"
 *
 * @param price - The price value to calculate precision for
 * @returns Number of decimal places to use
 */
export function calculatePricePrecision(price: number): number {
  if (price === 0) return 2;

  const absPrice = Math.abs(price);

  // High value assets (>= $1000): 2 decimals
  if (absPrice >= 1000) return 2;

  // Medium value assets (>= $1): 4 decimals
  if (absPrice >= 1) return 4;

  // Low value assets (< $1): Dynamic precision
  // Count leading zeros after decimal and add 4 significant digits
  const str = absPrice.toExponential();
  const exponent = parseInt(str.split('e')[1], 10);

  // Cap at 12 decimals to avoid excessive precision
  return Math.min(Math.abs(exponent) + 4, 12);
}

/**
 * Format a price with appropriate precision
 *
 * @param price - The price value to format
 * @returns Formatted price string with appropriate decimals
 */
export function formatPrice(price: number): string {
  const precision = calculatePricePrecision(price);
  return price.toFixed(precision);
}

/**
 * Format a price with compact notation for large values
 * Useful for displaying volume or market cap
 *
 * @param value - The value to format
 * @param currency - Currency symbol (default: '$')
 * @returns Formatted string with K/M/B suffix
 */
export function formatCompactPrice(value: number, currency: string = '$'): string {
  if (value === 0) return `${currency}0`;

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absValue >= 1_000_000_000) {
    return `${sign}${currency}${(absValue / 1_000_000_000).toFixed(2)}B`;
  }
  if (absValue >= 1_000_000) {
    return `${sign}${currency}${(absValue / 1_000_000).toFixed(2)}M`;
  }
  if (absValue >= 1_000) {
    return `${sign}${currency}${(absValue / 1_000).toFixed(2)}K`;
  }

  return `${sign}${currency}${formatPrice(absValue)}`;
}

/**
 * Format percentage change with appropriate styling hints
 *
 * @param change - Percentage change value
 * @param decimals - Number of decimal places (default: 2)
 * @returns Object with formatted value and direction
 */
export function formatPercentageChange(
  change: number,
  decimals: number = 2
): { value: string; isPositive: boolean; isZero: boolean } {
  const isPositive = change > 0;
  const isZero = change === 0;
  const prefix = isPositive ? '+' : '';
  const value = `${prefix}${change.toFixed(decimals)}%`;

  return { value, isPositive, isZero };
}

/**
 * Format volume with appropriate units
 *
 * @param volume - Volume value
 * @returns Formatted volume string
 */
export function formatVolume(volume: number): string {
  if (volume === 0) return '0';

  if (volume >= 1_000_000_000) {
    return `${(volume / 1_000_000_000).toFixed(2)}B`;
  }
  if (volume >= 1_000_000) {
    return `${(volume / 1_000_000).toFixed(2)}M`;
  }
  if (volume >= 1_000) {
    return `${(volume / 1_000).toFixed(2)}K`;
  }

  return volume.toFixed(2);
}

/**
 * Format price with currency symbol and appropriate decimals
 * Handles both USD and crypto base currencies
 *
 * @param price - The price value to format
 * @param baseCurrency - Currency type ('USD', 'BTC', 'ETH', etc.)
 * @returns Formatted price string with currency symbol for USD
 */
export function formatPriceWithCurrency(price: number, baseCurrency: string = 'USD'): string {
  if (baseCurrency === 'USD') {
    // For USD, use locale formatting for large numbers
    if (price >= 1000) {
      return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    return `$${formatPrice(price)}`;
  }

  // For crypto base currencies, use raw format without currency symbol
  return formatPrice(price);
}
