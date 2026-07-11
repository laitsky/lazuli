/**
 * Market intelligence analytics for Lazuli tracks A, B, and C.
 *
 * These functions are deterministic and side-effect free so API routes, tests,
 * and future realtime Workers can reuse the same calculations. Whenever public
 * REST data is a proxy rather than an exchange-native feed, the response types
 * label the model and expose assumptions instead of hiding uncertainty.
 */

import type {
  BacktestResponse,
  BacktestTrade,
  FundingArbitrageOpportunity,
  FundingArbitrageResponse,
  FundingRadarItem,
  FundingRadarResponse,
  FundingRateData,
  LiquidationLevel,
  LiquidationRadarResponse,
  OHLCV,
  OrderBook,
  OrderFlowPoint,
  OrderFlowResponse,
  StrategyDefinition,
  SupportedExchange,
  Ticker,
  Timeframe,
} from '@lazuli/shared';
import { parseSymbol } from '../utils/validation';

const LEVERAGE_BUCKETS = [5, 10, 20, 50, 100] as const;
const MAINTENANCE_MARGIN_RATE = 0.005;
const DEFAULT_EXECUTION_COST_BPS = 12;

/**
 * Build an estimated liquidation map from mark price, OI, and nearby book
 * liquidity. Long levels sit below mark and short levels sit above mark.
 */
export function buildLiquidationRadar(input: {
  exchange: SupportedExchange;
  symbol: string;
  ticker: Ticker | null;
  funding: FundingRateData | null;
  orderbook: OrderBook | null;
}): LiquidationRadarResponse {
  const markPrice = positiveNumber(input.funding?.markPrice) ?? positiveNumber(input.ticker?.last);
  const openInterestUsd =
    positiveNumber(input.funding?.openInterest) ?? positiveNumber(input.ticker?.openInterest);

  const levels =
    markPrice === null
      ? []
      : LEVERAGE_BUCKETS.flatMap((leverage) =>
          (['long', 'short'] as const).map((side) =>
            buildLiquidationLevel({
              side,
              leverage,
              markPrice,
              openInterestUsd,
              orderbook: input.orderbook,
            })
          )
        );

  const heatmap = levels
    .sort((a, b) => a.price - b.price)
    .map((level) => ({
      price: level.price,
      longIntensity: level.side === 'long' ? level.intensity : 0,
      shortIntensity: level.side === 'short' ? level.intensity : 0,
      totalEstimatedNotionalUsd: level.estimatedNotionalUsd,
    }));

  const cascades = levels
    .filter((level) => level.intensity >= 0.32)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 6)
    .map((level) => ({
      side: level.side,
      triggerPrice: level.price,
      estimatedNotionalUsd: level.estimatedNotionalUsd,
      severity: severityFromIntensity(level.intensity),
      reason: `${level.leverage}x ${level.side} liquidation band ${level.distancePercent.toFixed(
        2
      )}% from mark`,
    }));

  return {
    exchange: input.exchange,
    symbol: input.symbol,
    type: 'perp',
    markPrice,
    openInterestUsd,
    levels,
    heatmap,
    cascades,
    assumptions: {
      model: 'estimated-from-oi-mark-book',
      leverageBuckets: [...LEVERAGE_BUCKETS],
      maintenanceMarginRate: MAINTENANCE_MARGIN_RATE,
    },
    timestamp: Date.now(),
  };
}

/**
 * Convert OHLCV candles into a CVD and footprint proxy. The split estimates
 * aggressive buy/sell volume from candle body position inside the full range.
 */
export function buildOrderFlowResponse(input: {
  exchange: SupportedExchange;
  symbol: string;
  type: 'spot' | 'perp';
  timeframe: Timeframe;
  candles: OHLCV[];
}): OrderFlowResponse {
  let cumulativeDelta = 0;
  const points: OrderFlowPoint[] = input.candles.map((candle) => {
    const range = Math.max(candle.high - candle.low, Number.EPSILON);
    const closeLocation = clamp01((candle.close - candle.low) / range);
    const bodyDirection = candle.close >= candle.open ? 1 : -1;
    const bodyWeight = clamp01(Math.abs(candle.close - candle.open) / range);
    const buyShare = clamp01(0.5 + (closeLocation - 0.5) * 0.7 + bodyDirection * bodyWeight * 0.2);
    const buyVolume = candle.volume * buyShare;
    const sellVolume = candle.volume - buyVolume;
    const delta = buyVolume - sellVolume;
    cumulativeDelta += delta;

    return {
      timestamp: candle.timestamp,
      price: candle.close,
      buyVolume,
      sellVolume,
      delta,
      cumulativeDelta,
      footprintImbalance: candle.volume > 0 ? delta / candle.volume : 0,
    };
  });

  const totalVolume = points.reduce((sum, point) => sum + point.buyVolume + point.sellVolume, 0);
  const deltaPercentOfVolume = totalVolume > 0 ? (cumulativeDelta / totalVolume) * 100 : 0;
  const first = input.candles[0];
  const last = input.candles[input.candles.length - 1];
  const priceChange =
    first && last && first.close > 0 ? ((last.close - first.close) / first.close) * 100 : 0;

  return {
    exchange: input.exchange,
    symbol: input.symbol,
    type: input.type,
    timeframe: input.timeframe,
    points,
    summary: {
      cumulativeDelta,
      deltaPercentOfVolume,
      absorption:
        Math.abs(deltaPercentOfVolume) < 2 ? 'balanced' : deltaPercentOfVolume > 0 ? 'ask' : 'bid',
      divergence:
        priceChange > 1 && cumulativeDelta < 0
          ? 'bearish'
          : priceChange < -1 && cumulativeDelta > 0
            ? 'bullish'
            : 'none',
    },
    timestamp: Date.now(),
  };
}

/**
 * Rank perpetual contracts by funding pressure, OI-weighted carry, and volume.
 */
export function buildFundingRadar(rates: FundingRateData[], limit: number): FundingRadarResponse {
  const totalOpenInterestUsd = rates.reduce((sum, rate) => sum + (rate.openInterest ?? 0), 0);
  const positiveCarryUsd = rates.reduce(
    (sum, rate) => sum + Math.max(0, (rate.openInterest ?? 0) * rate.fundingRate * 3),
    0
  );
  const negativeCarryUsd = rates.reduce(
    (sum, rate) => sum + Math.min(0, (rate.openInterest ?? 0) * rate.fundingRate * 3),
    0
  );

  const items = rates
    .map<FundingRadarItem>((rate) => {
      const openInterestUsd = rate.openInterest;
      const oiShare =
        openInterestUsd && totalOpenInterestUsd > 0 ? openInterestUsd / totalOpenInterestUsd : 0;
      const fundingPressure = Math.min(1, Math.abs(rate.fundingRatePercent) / 0.08);
      const volumePressure = Math.min(1, Math.log10(Math.max(rate.volume24h ?? 1, 1)) / 10);
      const spikeScore = Math.round(
        (fundingPressure * 0.55 + oiShare * 0.15 + volumePressure * 0.2) * 100
      );

      return {
        symbol: rate.symbol,
        baseAsset: rate.baseAsset,
        exchange: rate.exchange,
        fundingRatePercent: rate.fundingRatePercent,
        annualizedRate: rate.annualizedRate,
        openInterestUsd,
        volume24h: rate.volume24h,
        oiWeightedCarryUsd: openInterestUsd ? openInterestUsd * rate.fundingRate * 3 : null,
        pressure:
          rate.fundingRate > 0.00001
            ? 'longs-pay'
            : rate.fundingRate < -0.00001
              ? 'shorts-pay'
              : 'neutral',
        spikeScore,
      };
    })
    .sort((a, b) => b.spikeScore - a.spikeScore)
    .slice(0, limit);

  const oiWeightedAverageFundingPercent =
    totalOpenInterestUsd > 0
      ? rates.reduce((sum, rate) => sum + (rate.openInterest ?? 0) * rate.fundingRatePercent, 0) /
        totalOpenInterestUsd
      : 0;

  return {
    items,
    count: items.length,
    stats: {
      totalOpenInterestUsd,
      oiWeightedAverageFundingPercent,
      positiveCarryUsd,
      negativeCarryUsd,
    },
    timestamp: Date.now(),
  };
}

/**
 * Build cost-adjusted funding arbitrage candidates from cross-exchange rates.
 */
export function buildFundingArbitrage(
  inputs: Array<{ exchange: SupportedExchange; rates: FundingRateData[] }>,
  limit: number,
  executionCostBps = DEFAULT_EXECUTION_COST_BPS
): FundingArbitrageResponse {
  const byAsset = new Map<string, FundingRateData[]>();
  for (const input of inputs) {
    for (const rate of input.rates) {
      const group = byAsset.get(rate.baseAsset) ?? [];
      group.push(rate);
      byAsset.set(rate.baseAsset, group);
    }
  }

  const opportunities = Array.from(byAsset.entries())
    .flatMap<FundingArbitrageOpportunity>(([asset, rates]) => {
      if (rates.length < 2) return [];
      const sorted = [...rates].sort((a, b) => a.fundingRate - b.fundingRate);
      const longLeg = sorted[0];
      const shortLeg = sorted[sorted.length - 1];
      if (!longLeg || !shortLeg) return [];

      const grossAnnualizedYield = (shortLeg.fundingRate - longLeg.fundingRate) * 3 * 365 * 100;
      const basisPercent = calculateBasisPercent(longLeg.markPrice, shortLeg.markPrice);
      const netAnnualizedYield =
        grossAnnualizedYield - executionCostBps / 100 - Math.abs(basisPercent);

      return [
        {
          asset,
          longExchange: longLeg.exchange,
          shortExchange: shortLeg.exchange,
          grossAnnualizedYield,
          estimatedExecutionCostBps: executionCostBps,
          basisPercent,
          netAnnualizedYield,
          confidence:
            longLeg.markPrice && shortLeg.markPrice && longLeg.openInterest && shortLeg.openInterest
              ? 'high'
              : longLeg.markPrice && shortLeg.markPrice
                ? 'medium'
                : 'low',
        },
      ];
    })
    .filter((item) => item.netAnnualizedYield > 0)
    .sort((a, b) => b.netAnnualizedYield - a.netAnnualizedYield)
    .slice(0, limit);

  return { opportunities, count: opportunities.length, timestamp: Date.now() };
}

/**
 * Run a simple server-side backtest for a strategy definition.
 */
export function runBacktest(input: {
  exchange: SupportedExchange;
  symbol: string;
  type: 'spot' | 'perp';
  timeframe: Timeframe;
  candles: OHLCV[];
  strategy: StrategyDefinition;
}): BacktestResponse {
  const candles = input.candles;
  const strategy = input.strategy;
  const fast = ema(
    candles.map((candle) => candle.close),
    strategy.fastPeriod
  );
  const slow = ema(
    candles.map((candle) => candle.close),
    strategy.slowPeriod
  );
  const rsiValues = rsi(
    candles.map((candle) => candle.close),
    strategy.rsiPeriod
  );
  const fee = strategy.feeBps / 10_000;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestResponse['equityCurve'] = [];
  let equity = 100;
  let peak = 100;
  let position: { direction: 'long' | 'short'; entryPrice: number; entryTime: number } | null =
    null;

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousFast = fast[index - 1];
    const previousSlow = slow[index - 1];
    const currentFast = fast[index];
    const currentSlow = slow[index];
    const currentRsi = rsiValues[index];
    if (
      !candle ||
      previousFast === null ||
      previousSlow === null ||
      currentFast === null ||
      currentSlow === null
    ) {
      continue;
    }

    const entrySignal = shouldEnter(strategy, {
      previousFast,
      previousSlow,
      currentFast,
      currentSlow,
      rsi: currentRsi,
      candle,
    });
    const exitSignal = shouldExit(strategy, {
      previousFast,
      previousSlow,
      currentFast,
      currentSlow,
      rsi: currentRsi,
    });

    if (!position && entrySignal) {
      position = {
        direction: entrySignal,
        entryPrice: candle.close,
        entryTime: candle.timestamp,
      };
    } else if (position && exitSignal) {
      const rawPnl =
        position.direction === 'long'
          ? (candle.close - position.entryPrice) / position.entryPrice
          : (position.entryPrice - candle.close) / position.entryPrice;
      const pnlPercent = (rawPnl - fee * 2) * 100;
      equity *= 1 + pnlPercent / 100;
      trades.push({
        entryTime: position.entryTime,
        exitTime: candle.timestamp,
        direction: position.direction,
        entryPrice: position.entryPrice,
        exitPrice: candle.close,
        pnlPercent,
        reason: 'strategy-exit',
      });
      position = null;
    }

    peak = Math.max(peak, equity);
    equityCurve.push({
      timestamp: candle.timestamp,
      equity,
      drawdownPercent: peak > 0 ? ((equity - peak) / peak) * 100 : 0,
    });
  }

  const returns = trades.map((trade) => trade.pnlPercent);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));

  return {
    exchange: input.exchange,
    symbol: input.symbol,
    type: input.type,
    timeframe: input.timeframe,
    strategy,
    metrics: {
      totalReturnPercent: equity - 100,
      maxDrawdownPercent: Math.min(0, ...equityCurve.map((point) => point.drawdownPercent)),
      sharpe: calculateSharpe(returns),
      winRate: trades.length > 0 ? wins.length / trades.length : 0,
      tradeCount: trades.length,
      profitFactor:
        grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : 0,
    },
    equityCurve,
    trades,
    timestamp: Date.now(),
  };
}

export function defaultStrategyDefinition(mode: StrategyDefinition['mode']): StrategyDefinition {
  return {
    name: `${mode} baseline`,
    mode,
    fastPeriod: mode === 'breakout' ? 12 : 9,
    slowPeriod: mode === 'mean-reversion' ? 50 : 26,
    rsiPeriod: 14,
    rsiOversold: 32,
    rsiOverbought: 68,
    feeBps: 6,
  };
}

function buildLiquidationLevel(input: {
  side: 'long' | 'short';
  leverage: number;
  markPrice: number;
  openInterestUsd: number | null;
  orderbook: OrderBook | null;
}): LiquidationLevel {
  const distance = Math.max(0.0025, 1 / input.leverage - MAINTENANCE_MARGIN_RATE);
  const price =
    input.side === 'long' ? input.markPrice * (1 - distance) : input.markPrice * (1 + distance);
  const distancePercent = Math.abs((price - input.markPrice) / input.markPrice) * 100;
  const leverageWeight = Math.min(1, input.leverage / 50);
  const bookWeight = orderbookLiquidityWeight(input.orderbook, input.side, price);
  const estimatedNotionalUsd =
    (input.openInterestUsd ?? 0) *
    leverageDistributionWeight(input.leverage) *
    (0.65 + bookWeight * 0.35);
  const intensity = clamp01(
    leverageWeight * 0.45 + bookWeight * 0.35 + Math.min(1, estimatedNotionalUsd / 50_000_000) * 0.2
  );

  return {
    side: input.side,
    leverage: input.leverage,
    price,
    distancePercent,
    estimatedNotionalUsd,
    intensity,
  };
}

function leverageDistributionWeight(leverage: number): number {
  if (leverage <= 5) return 0.14;
  if (leverage <= 10) return 0.22;
  if (leverage <= 20) return 0.28;
  if (leverage <= 50) return 0.24;
  return 0.12;
}

function orderbookLiquidityWeight(
  orderbook: OrderBook | null,
  side: 'long' | 'short',
  price: number
): number {
  if (!orderbook) return 0.25;
  const levels = side === 'long' ? orderbook.bids : orderbook.asks;
  const nearby = levels.filter((level) => Math.abs(level.price - price) / price <= 0.01);
  const total = levels.reduce((sum, level) => sum + level.total, 0);
  const local = nearby.reduce((sum, level) => sum + level.total, 0);
  return total > 0 ? clamp01(local / total) : 0.25;
}

function severityFromIntensity(intensity: number): 'low' | 'medium' | 'high' | 'extreme' {
  if (intensity >= 0.78) return 'extreme';
  if (intensity >= 0.58) return 'high';
  if (intensity >= 0.4) return 'medium';
  return 'low';
}

function shouldEnter(
  strategy: StrategyDefinition,
  input: {
    previousFast: number;
    previousSlow: number;
    currentFast: number;
    currentSlow: number;
    rsi: number | null;
    candle: OHLCV;
  }
): 'long' | 'short' | null {
  if (strategy.mode === 'momentum') {
    return input.previousFast <= input.previousSlow && input.currentFast > input.currentSlow
      ? 'long'
      : null;
  }
  if (strategy.mode === 'breakout') {
    return input.currentFast > input.currentSlow && input.candle.close >= input.candle.high * 0.995
      ? 'long'
      : null;
  }
  if (input.rsi !== null && input.rsi <= strategy.rsiOversold) return 'long';
  if (input.rsi !== null && input.rsi >= strategy.rsiOverbought) return 'short';
  return null;
}

function shouldExit(
  strategy: StrategyDefinition,
  input: {
    previousFast: number;
    previousSlow: number;
    currentFast: number;
    currentSlow: number;
    rsi: number | null;
  }
): boolean {
  if (strategy.mode === 'momentum' || strategy.mode === 'breakout') {
    return input.previousFast >= input.previousSlow && input.currentFast < input.currentSlow;
  }
  return input.rsi !== null && input.rsi > 45 && input.rsi < 55;
}

function ema(values: number[], period: number): Array<number | null> {
  const multiplier = 2 / (period + 1);
  const result: Array<number | null> = [];
  let previous: number | null = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    if (index < period - 1) {
      result.push(null);
      continue;
    }
    if (previous === null) {
      const seed =
        values.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item, 0) / period;
      previous = seed;
      result.push(seed);
      continue;
    }
    previous = (value - previous) * multiplier + previous;
    result.push(previous);
  }
  return result;
}

function rsi(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array.from({ length: values.length }, () => null);
  let averageGain = 0;
  let averageLoss = 0;

  for (let index = 1; index < values.length; index += 1) {
    const change = (values[index] ?? 0) - (values[index - 1] ?? 0);
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);

    if (index <= period) {
      averageGain += gain;
      averageLoss += loss;
      if (index === period) {
        averageGain /= period;
        averageLoss /= period;
      }
      continue;
    }

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    const relativeStrength =
      averageLoss === 0 ? Number.POSITIVE_INFINITY : averageGain / averageLoss;
    result[index] = 100 - 100 / (1 + relativeStrength);
  }

  return result;
}

/**
 * Compute the most recent Wilder-smoothed RSI value for a series. Exposed so
 * the alt screener uses the same RSI definition as the backtest path rather
 * than a simple-average variant that would disagree on trending data.
 */
export function calculateWilderRsi(values: number[], period: number): number | null {
  if (values.length <= period) return null;
  const series = rsi(values, period);
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index];
    if (value !== null) return value;
  }
  return null;
}

function calculateSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1);
  const stdev = Math.sqrt(variance);
  return stdev > 0 ? (average / stdev) * Math.sqrt(252) : 0;
}

function calculateBasisPercent(a: number | null, b: number | null): number {
  if (!a || !b) return 0;
  const midpoint = (a + b) / 2;
  return midpoint > 0 ? ((b - a) / midpoint) * 100 : 0;
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function normalizePerpSymbol(symbol: string): string {
  if (symbol.endsWith('.P')) return symbol;
  const parsed = parseSymbol(symbol);
  return `${parsed.base}${parsed.quote || 'USDT'}.P`;
}
