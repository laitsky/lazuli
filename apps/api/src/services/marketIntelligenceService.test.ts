import { describe, expect, test } from 'bun:test';
import type { FundingRateData, OHLCV, OrderBook, Ticker } from '@lazuli/shared';
import {
  buildFundingArbitrage,
  buildFundingRadar,
  buildLiquidationRadar,
  buildOrderFlowResponse,
  defaultStrategyDefinition,
  runBacktest,
} from './marketIntelligenceService';

const timestamp = 1_700_000_000_000;

function ticker(values: Partial<Ticker> = {}): Ticker {
  return {
    exchange: 'bybit',
    symbol: 'BTCUSDT.P',
    type: 'perp',
    bid: 99_990,
    ask: 100_010,
    last: 100_000,
    high24h: 102_000,
    low24h: 98_000,
    volume24h: 1_000,
    quoteVolume24h: 100_000_000,
    change24h: 1_000,
    percentage24h: 1,
    timestamp,
    openInterest: 2_000_000_000,
    ...values,
  };
}

function funding(exchange: string, rate: number, markPrice: number): FundingRateData {
  return {
    exchange,
    symbol: 'BTCUSDT.P',
    baseAsset: 'BTC',
    fundingRate: rate,
    fundingRatePercent: rate * 100,
    annualizedRate: rate * 100 * 3 * 365,
    nextFundingTime: timestamp + 8 * 60 * 60 * 1000,
    markPrice,
    indexPrice: markPrice,
    openInterest: 2_000_000_000,
    volume24h: 100_000_000,
    timestamp,
  };
}

function orderbook(): OrderBook {
  return {
    exchange: 'bybit',
    symbol: 'BTCUSDT.P',
    type: 'perp',
    bids: [
      { price: 99_500, amount: 10, total: 10 },
      { price: 99_000, amount: 20, total: 30 },
    ],
    asks: [
      { price: 100_500, amount: 8, total: 8 },
      { price: 101_000, amount: 16, total: 24 },
    ],
    timestamp,
  };
}

function candles(count: number, start = 100): OHLCV[] {
  return Array.from({ length: count }, (_, index) => {
    const open = start + index;
    const close = open + (index % 5 === 0 ? -0.5 : 1.2);
    return {
      timestamp: timestamp + index * 60_000,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1_000 + index * 10,
    };
  });
}

describe('market intelligence service', () => {
  test('builds transparent estimated liquidation levels around mark price', () => {
    const radar = buildLiquidationRadar({
      exchange: 'bybit',
      symbol: 'BTCUSDT.P',
      ticker: ticker(),
      funding: funding('bybit', 0.0001, 100_000),
      orderbook: orderbook(),
    });

    expect(radar.assumptions.model).toBe('estimated-from-oi-mark-book');
    expect(radar.levels).toHaveLength(10);
    expect(radar.levels.some((level) => level.side === 'long' && level.price < 100_000)).toBe(true);
    expect(radar.levels.some((level) => level.side === 'short' && level.price > 100_000)).toBe(
      true
    );
  });

  test('derives CVD direction and divergence from candle footprints', () => {
    const flow = buildOrderFlowResponse({
      exchange: 'bybit',
      symbol: 'BTC-USDT',
      type: 'spot',
      timeframe: '1m',
      candles: candles(30),
    });

    expect(flow.points).toHaveLength(30);
    expect(Number.isFinite(flow.summary.cumulativeDelta)).toBe(true);
    expect(['ask', 'bid', 'balanced'].includes(flow.summary.absorption)).toBe(true);
  });

  test('cost-adjusts funding arbitrage yields by execution cost and basis', () => {
    const response = buildFundingArbitrage(
      [
        { exchange: 'bybit', rates: [funding('bybit', -0.0001, 99_900)] },
        { exchange: 'okx', rates: [funding('okx', 0.0003, 100_100)] },
      ],
      10,
      10
    );

    expect(response.count).toBe(1);
    expect(response.opportunities[0]?.asset).toBe('BTC');
    expect(
      (response.opportunities[0]?.netAnnualizedYield ?? 0) <
        (response.opportunities[0]?.grossAnnualizedYield ?? 0)
    ).toBe(true);
  });

  test('ranks funding radar by funding pressure, not open interest', () => {
    // Regression for the oiShare weight scale bug: a large-cap with mild
    // funding must NOT outrank a small-cap with extreme funding.
    const rates: FundingRateData[] = [
      {
        exchange: 'bybit',
        symbol: 'BTCUSDT.P',
        baseAsset: 'BTC',
        fundingRate: 0.0001, // 0.01 % — mild
        fundingRatePercent: 0.01,
        annualizedRate: 0.01 * 3 * 365,
        nextFundingTime: timestamp + 8 * 60 * 60 * 1000,
        markPrice: 100_000,
        indexPrice: 100_000,
        openInterest: 2_000_000_000, // dominant OI share
        volume24h: 100_000_000,
        timestamp,
      },
      {
        exchange: 'bybit',
        symbol: 'PEPEUSDT.P',
        baseAsset: 'PEPE',
        fundingRate: 0.0005, // 0.05 % — extreme
        fundingRatePercent: 0.05,
        annualizedRate: 0.05 * 3 * 365,
        nextFundingTime: timestamp + 8 * 60 * 60 * 1000,
        markPrice: 0.01,
        indexPrice: 0.01,
        openInterest: 20_000_000, // tiny OI share
        volume24h: 5_000_000,
        timestamp,
      },
    ];

    const radar = buildFundingRadar(rates, 10);

    expect(radar.count).toBe(2);
    expect(radar.items[0]?.baseAsset).toBe('PEPE');
    expect(radar.items[1]?.baseAsset).toBe('BTC');
  });

  test('keeps spikeScore within 0-100 for all funding radar items', () => {
    const rates: FundingRateData[] = [
      {
        exchange: 'bybit',
        symbol: 'BTCUSDT.P',
        baseAsset: 'BTC',
        fundingRate: 0.001, // 0.1 % — saturates funding pressure
        fundingRatePercent: 0.1,
        annualizedRate: 0.1 * 3 * 365,
        nextFundingTime: timestamp,
        markPrice: 100_000,
        indexPrice: 100_000,
        openInterest: 5_000_000_000, // dominant OI
        volume24h: 1_000_000_000,
        timestamp,
      },
      {
        exchange: 'bybit',
        symbol: 'ETHUSDT.P',
        baseAsset: 'ETH',
        fundingRate: 0,
        fundingRatePercent: 0,
        annualizedRate: 0,
        nextFundingTime: timestamp,
        markPrice: 4_000,
        indexPrice: 4_000,
        openInterest: 1_000_000,
        volume24h: 100,
        timestamp,
      },
    ];

    const radar = buildFundingRadar(rates, 10);

    for (const item of radar.items) {
      expect(item.spikeScore >= 0 && item.spikeScore <= 100).toBe(true);
    }
  });

  test('aggregates funding radar stats from open interest', () => {
    const radar = buildFundingRadar(
      [funding('bybit', 0.0001, 100_000), funding('okx', -0.0002, 100_000)],
      10
    );

    expect(radar.stats.totalOpenInterestUsd).toBe(4_000_000_000);
    expect(radar.stats.positiveCarryUsd > 0).toBe(true);
    expect(radar.stats.negativeCarryUsd < 0).toBe(true);
  });

  test('runs a bounded server-side backtest with metrics and equity curve', () => {
    const result = runBacktest({
      exchange: 'bybit',
      symbol: 'BTC-USDT',
      type: 'spot',
      timeframe: '1m',
      candles: candles(120),
      strategy: defaultStrategyDefinition('momentum'),
    });

    expect(result.metrics.tradeCount >= 0).toBe(true);
    expect(result.equityCurve.length > 0).toBe(true);
    expect(Number.isFinite(result.metrics.totalReturnPercent)).toBe(true);
  });
});
