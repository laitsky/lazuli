import { OHLCV } from '../types';

/**
 * Technical Indicator Service
 * Provides calculations for common technical indicators:
 * - SMA (Simple Moving Average)
 * - EMA (Exponential Moving Average)
 * - RSI (Relative Strength Index)
 *
 * All indicators are calculated from OHLCV data and return values
 * aligned with the input data timestamps.
 */

/**
 * Single data point with OHLCV and all calculated indicator values
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
 * Configuration for which indicators to calculate
 */
export interface IndicatorConfig {
  sma?: number[]; // Array of SMA periods to calculate (e.g., [20, 50, 200])
  ema?: number[]; // Array of EMA periods to calculate (e.g., [12, 26])
  rsi?: number[]; // Array of RSI periods to calculate (e.g., [14])
}

/**
 * Response structure for technical indicators endpoint
 */
export interface TechnicalIndicatorResponse {
  exchange: string;
  symbol: string;
  timeframe: string;
  marketType: 'spot' | 'perp';
  indicators: {
    sma: number[];
    ema: number[];
    rsi: number[];
  };
  data: IndicatorDataPoint[];
  candleCount: number;
}

/**
 * Calculate Simple Moving Average (SMA)
 * SMA = Sum of closing prices over N periods / N
 *
 * The SMA is a lagging indicator that smooths price data by creating
 * a constantly updated average price over a specific time period.
 *
 * @param prices - Array of closing prices (oldest to newest)
 * @param period - SMA period (e.g., 20, 50, 200)
 * @returns Array of SMA values (null for insufficient data points)
 */
function calculateSMA(prices: number[], period: number): (number | null)[] {
  if (prices.length === 0 || period <= 0) {
    return [];
  }

  const smaValues: (number | null)[] = [];

  // Need at least 'period' data points to calculate SMA
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      // Not enough data points yet
      smaValues.push(null);
    } else {
      // Calculate sum of last 'period' prices
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += prices[i - j];
      }
      smaValues.push(sum / period);
    }
  }

  return smaValues;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * EMA = (Price * Multiplier) + (Previous EMA * (1 - Multiplier))
 * where Multiplier = 2 / (Period + 1)
 *
 * The EMA gives more weight to recent prices, making it more responsive
 * to new information compared to the SMA.
 *
 * @param prices - Array of closing prices (oldest to newest)
 * @param period - EMA period (e.g., 12, 26, 50, 200)
 * @returns Array of EMA values (null for insufficient data points)
 */
function calculateEMA(prices: number[], period: number): (number | null)[] {
  if (prices.length === 0 || period <= 0) {
    return [];
  }

  const emaValues: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  // Need at least 'period' data points to calculate the first EMA
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
    const currentEMA = prices[i] * multiplier + previousEMA * (1 - multiplier);
    emaValues.push(currentEMA);
    previousEMA = currentEMA;
  }

  return emaValues;
}

/**
 * Calculate Relative Strength Index (RSI)
 *
 * RSI = 100 - (100 / (1 + RS))
 * where RS = Average Gain / Average Loss over N periods
 *
 * RSI is a momentum oscillator that measures the speed and magnitude
 * of directional price movements. Values range from 0 to 100:
 * - RSI > 70: Overbought (potential sell signal)
 * - RSI < 30: Oversold (potential buy signal)
 *
 * Uses Wilder's smoothing method for the average gain/loss calculation.
 *
 * @param prices - Array of closing prices (oldest to newest)
 * @param period - RSI period (typically 14)
 * @returns Array of RSI values (null for insufficient data points)
 */
function calculateRSI(prices: number[], period: number): (number | null)[] {
  if (prices.length === 0 || period <= 0) {
    return [];
  }

  const rsiValues: (number | null)[] = [];

  // Need at least period + 1 data points to calculate RSI
  // (period changes + 1 initial price)
  if (prices.length < period + 1) {
    return prices.map(() => null);
  }

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // First value is null (no previous price to compare)
  rsiValues.push(null);

  // Calculate initial average gain and loss using SMA
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < period; i++) {
    // Push null for initial period where RSI cannot be calculated
    if (i < period - 1) {
      rsiValues.push(null);
    }

    const change = changes[i];
    if (change > 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }

  avgGain /= period;
  avgLoss /= period;

  // Calculate first RSI value
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  rsiValues.push(rsi);

  // Calculate subsequent RSI values using Wilder's smoothing
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    // Wilder's smoothing: avgGain = (prevAvgGain * (period - 1) + currentGain) / period
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const currentRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const currentRSI = 100 - 100 / (1 + currentRS);
    rsiValues.push(currentRSI);
  }

  return rsiValues;
}

/**
 * Calculate all requested technical indicators for OHLCV data
 *
 * This function processes OHLCV data and calculates multiple indicators
 * in a single pass, returning a comprehensive data structure with all
 * indicator values aligned with the input timestamps.
 *
 * @param ohlcvData - Array of OHLCV candles (oldest to newest)
 * @param config - Configuration specifying which indicators to calculate
 * @returns Array of data points with all indicator values
 */
export function calculateIndicators(
  ohlcvData: OHLCV[],
  config: IndicatorConfig
): IndicatorDataPoint[] {
  if (ohlcvData.length === 0) {
    return [];
  }

  // Extract closing prices for calculations
  const closes = ohlcvData.map((candle) => candle.close);

  // Calculate all requested SMAs
  const smaResults: Map<number, (number | null)[]> = new Map();
  if (config.sma && config.sma.length > 0) {
    for (const period of config.sma) {
      if (period > 0) {
        smaResults.set(period, calculateSMA(closes, period));
      }
    }
  }

  // Calculate all requested EMAs
  const emaResults: Map<number, (number | null)[]> = new Map();
  if (config.ema && config.ema.length > 0) {
    for (const period of config.ema) {
      if (period > 0) {
        emaResults.set(period, calculateEMA(closes, period));
      }
    }
  }

  // Calculate all requested RSIs
  const rsiResults: Map<number, (number | null)[]> = new Map();
  if (config.rsi && config.rsi.length > 0) {
    for (const period of config.rsi) {
      if (period > 0) {
        rsiResults.set(period, calculateRSI(closes, period));
      }
    }
  }

  // Build result array with OHLCV and all indicator values per timestamp
  const result: IndicatorDataPoint[] = ohlcvData.map((candle, index) => {
    // Collect SMA values for this candle
    const sma: Record<number, number | null> = {};
    for (const [period, values] of smaResults) {
      sma[period] = values[index];
    }

    // Collect EMA values for this candle
    const ema: Record<number, number | null> = {};
    for (const [period, values] of emaResults) {
      ema[period] = values[index];
    }

    // Collect RSI values for this candle
    const rsi: Record<number, number | null> = {};
    for (const [period, values] of rsiResults) {
      rsi[period] = values[index];
    }

    return {
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      sma,
      ema,
      rsi,
    };
  });

  return result;
}

/**
 * Default indicator configuration with common periods
 * - SMA: 20, 50, 200 (short, medium, long term trends)
 * - EMA: 12, 26 (MACD components), 9, 21 (common trading periods)
 * - RSI: 14 (standard RSI period)
 */
export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {
  sma: [20, 50, 200],
  ema: [9, 12, 21, 26],
  rsi: [14],
};

/**
 * Parse indicator periods from query string
 * Accepts comma-separated numbers (e.g., "20,50,200")
 *
 * @param value - Query string value
 * @param defaultPeriods - Default periods if parsing fails
 * @returns Array of valid period numbers
 */
export function parseIndicatorPeriods(
  value: string | undefined,
  defaultPeriods: number[]
): number[] {
  if (!value) {
    return defaultPeriods;
  }

  const periods = value
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0 && n <= 500); // Max period of 500

  return periods.length > 0 ? periods : defaultPeriods;
}
