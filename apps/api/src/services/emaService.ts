import { OHLCV } from '../types';

/**
 * EMA (Exponential Moving Average) calculation service
 * Calculates multiple EMA periods (1-400) for technical analysis
 */

/**
 * Single EMA data point with all period values
 */
export interface EMADataPoint {
  timestamp: number;
  close: number;
  emas: Record<number, number>; // period -> EMA value
}

/**
 * Response structure for SuperEMA endpoint
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
 * Calculate a single EMA value
 * EMA = (Price * Multiplier) + (Previous EMA * (1 - Multiplier))
 * where Multiplier = 2 / (Period + 1)
 *
 * @param prices - Array of closing prices (oldest to newest)
 * @param period - EMA period (e.g., 20, 50, 200)
 * @returns Array of EMA values (same length as prices, first (period-1) values are null)
 */
function calculateEMA(prices: number[], period: number): (number | null)[] {
  if (prices.length === 0 || period <= 0) {
    return [];
  }

  const emaValues: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  // Need at least 'period' data points to calculate the first EMA
  // Start with SMA for the first EMA value
  if (prices.length < period) {
    return prices.map(() => null);
  }

  // Calculate initial SMA as the first EMA value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    emaValues.push(null);
    sum += prices[i];
  }

  // First EMA is the SMA of the first 'period' prices
  let previousEMA = sum / period;
  emaValues[period - 1] = previousEMA;

  // Calculate subsequent EMA values
  for (let i = period; i < prices.length; i++) {
    const currentEMA = (prices[i] * multiplier) + (previousEMA * (1 - multiplier));
    emaValues.push(currentEMA);
    previousEMA = currentEMA;
  }

  return emaValues;
}

/**
 * Calculate multiple EMAs (1 to maxPeriod) for OHLCV data
 *
 * @param ohlcvData - Array of OHLCV candles (oldest to newest)
 * @param maxPeriod - Maximum EMA period to calculate (default: 400)
 * @returns Array of data points with all EMA values
 */
export function calculateSuperEMA(
  ohlcvData: OHLCV[],
  maxPeriod: number = 400
): EMADataPoint[] {
  if (ohlcvData.length === 0) {
    return [];
  }

  // Extract closing prices
  const closes = ohlcvData.map(candle => candle.close);

  // Pre-calculate all EMAs (1 to maxPeriod)
  const allEMAs: Map<number, (number | null)[]> = new Map();

  for (let period = 1; period <= maxPeriod; period++) {
    allEMAs.set(period, calculateEMA(closes, period));
  }

  // Build result array with all EMA values per timestamp
  const result: EMADataPoint[] = ohlcvData.map((candle, index) => {
    const emas: Record<number, number> = {};

    for (let period = 1; period <= maxPeriod; period++) {
      const emaArray = allEMAs.get(period);
      if (emaArray && emaArray[index] !== null) {
        emas[period] = emaArray[index] as number;
      }
    }

    return {
      timestamp: candle.timestamp,
      close: candle.close,
      emas,
    };
  });

  return result;
}

/**
 * Calculate selected EMAs for OHLCV data
 * More efficient when only specific periods are needed
 *
 * @param ohlcvData - Array of OHLCV candles
 * @param periods - Array of specific EMA periods to calculate
 * @returns Array of data points with selected EMA values
 */
export function calculateSelectedEMAs(
  ohlcvData: OHLCV[],
  periods: number[]
): EMADataPoint[] {
  if (ohlcvData.length === 0 || periods.length === 0) {
    return [];
  }

  // Extract closing prices
  const closes = ohlcvData.map(candle => candle.close);

  // Calculate only the requested EMAs
  const selectedEMAs: Map<number, (number | null)[]> = new Map();

  for (const period of periods) {
    if (period > 0) {
      selectedEMAs.set(period, calculateEMA(closes, period));
    }
  }

  // Build result array
  const result: EMADataPoint[] = ohlcvData.map((candle, index) => {
    const emas: Record<number, number> = {};

    for (const period of periods) {
      const emaArray = selectedEMAs.get(period);
      if (emaArray && emaArray[index] !== null) {
        emas[period] = emaArray[index] as number;
      }
    }

    return {
      timestamp: candle.timestamp,
      close: candle.close,
      emas,
    };
  });

  return result;
}
