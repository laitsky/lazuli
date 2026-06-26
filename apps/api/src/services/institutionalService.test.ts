import { describe, expect, test } from 'bun:test';
import type { FundingRateData, Ticker } from '@lazuli/shared';
import {
  buildFlowStreak,
  getInstitutionalConfluence,
  parseVolatilityCandles,
  parseDeribitOptionName,
  parseFarsideTable,
} from './institutionalService';

describe('institutional service', () => {
  test('normalizes Farside-style ETF tables into chronological USD flows', () => {
    const html = `
      <table>
        <tr><th>Date</th><th>IBIT</th><th>FBTC</th><th>GBTC</th><th>Total</th></tr>
        <tr><td>2026-06-21</td><td>10.5</td><td>-</td><td>(2.0)</td><td>8.5</td></tr>
        <tr><td>2026-06-20</td><td>1.0</td><td>2.0</td><td>(1.5)</td><td>1.5</td></tr>
      </table>
    `;

    const flows = parseFarsideTable('BTC', html);

    expect(flows).toHaveLength(2);
    expect(flows[0]?.date).toBe('2026-06-20');
    expect(flows[0]?.totalNetFlowUsd).toBe(1_500_000);
    expect(flows[0]?.cumulativeNetFlowUsd).toBe(1_500_000);
    expect(flows[1]?.totalNetFlowUsd).toBe(8_500_000);
    expect(flows[1]?.cumulativeNetFlowUsd).toBe(10_000_000);
    expect(flows[1]?.fundFlows.GBTC).toBe(-2_000_000);
  });

  test('maps Deribit option instrument names into normalized contract metadata', () => {
    const parsed = parseDeribitOptionName('ETH-27JUN26-4200-C');

    expect(parsed?.asset).toBe('ETH');
    expect(parsed?.optionType).toBe('call');
    expect(parsed?.strike).toBe(4200);
    expect(parsed?.expiry).toBe('2026-06-27');
    expect(parsed?.expiryTimestamp).toBe(Date.UTC(2026, 5, 27, 8, 0, 0));
  });

  test('counts only consecutive ETF flow streak days', () => {
    const streak = buildFlowStreak([
      flow('2026-06-18', 100_000_000),
      flow('2026-06-19', -25_000_000),
      flow('2026-06-20', 50_000_000),
      flow('2026-06-21', 30_000_000),
    ]);

    expect(streak.direction).toBe('inflow');
    expect(streak.days).toBe(2);
    expect(streak.totalUsd).toBe(80_000_000);
  });

  test('parses volatility candles from nested Deribit data payloads', () => {
    const candles = parseVolatilityCandles({
      data: [
        [1_787_424_000_000, 50, 55, 48, 52],
        { timestamp: 1_787_510_400_000, open: 52, high: 54, low: 51, close: 53 },
      ],
    });

    expect(candles).toHaveLength(2);
    expect(candles[0]?.close).toBe(52);
    expect(candles[1]?.timestamp).toBe(1_787_510_400_000);
  });

  test('scores ETF-led confluence when flows are strong and leverage is calm', async () => {
    const response = await getInstitutionalConfluence({
      asset: 'BTC',
      etf: {
        asset: 'BTC',
        range: '30d',
        flows: [],
        funds: [],
        latest: {
          date: '2026-06-22',
          asset: 'BTC',
          totalNetFlowUsd: 500_000_000,
          cumulativeNetFlowUsd: 55_000_000_000,
          fundFlows: { IBIT: 500_000_000 },
          leaderTicker: 'IBIT',
          laggardTicker: 'IBIT',
          anomaly: true,
        },
        streak: { direction: 'inflow', days: 5, totalUsd: 900_000_000, averageUsd: 180_000_000 },
        totals: {
          netFlowUsd: 900_000_000,
          cumulativeNetFlowUsd: 55_000_000_000,
          averageDailyFlowUsd: 180_000_000,
          positiveDays: 5,
          negativeDays: 0,
          anomalyDays: 1,
        },
        provider: {
          provider: 'test',
          source: 'live',
          ok: true,
          updatedAt: Date.now(),
          stale: false,
        },
        timestamp: Date.now(),
      },
      options: {
        asset: 'BTC',
        expiries: [
          {
            expiry: '2026-06-27',
            expiryTimestamp: Date.UTC(2026, 5, 27),
            daysToExpiry: 4,
            instrumentCount: 2,
            totalOpenInterest: 100,
            totalVolume24h: 1000,
            callOpenInterest: 60,
            putOpenInterest: 40,
            putCallRatio: 0.67,
            maxPainStrike: 100_000,
            largestCallWall: null,
            largestPutWall: null,
            atmImpliedVolatility: 45,
            skew25Delta: -2,
          },
        ],
        provider: {
          provider: 'test',
          source: 'live',
          ok: true,
          updatedAt: Date.now(),
          stale: false,
        },
        timestamp: Date.now(),
      },
      volatility: {
        asset: 'BTC',
        range: '90d',
        candles: [],
        current: 45,
        rank: 55,
        provider: {
          provider: 'test',
          source: 'live',
          ok: true,
          updatedAt: Date.now(),
          stale: false,
        },
        timestamp: Date.now(),
      },
      fundingRates: [funding('bybit', 0.002, 100_000_000)],
      spotTicker: ticker(2.5),
    });

    expect(response.regime).toBe('etf-led');
    expect(response.regimeScore > 55).toBe(true);
    expect(response.signals.find((signal) => signal.id === 'etfDemand')?.direction).toBe('bullish');
  });

  test('keeps weak composites mixed even when one demand input is loud', async () => {
    const response = await getInstitutionalConfluence({
      asset: 'BTC',
      etf: {
        asset: 'BTC',
        range: '30d',
        flows: [],
        funds: [],
        latest: flow('2026-06-22', 400_000_000),
        streak: { direction: 'inflow', days: 4, totalUsd: 700_000_000, averageUsd: 175_000_000 },
        totals: {
          netFlowUsd: 700_000_000,
          cumulativeNetFlowUsd: 54_000_000_000,
          averageDailyFlowUsd: 175_000_000,
          positiveDays: 4,
          negativeDays: 0,
          anomalyDays: 1,
        },
        provider: provider('live', false),
        timestamp: Date.now(),
      },
      options: {
        asset: 'BTC',
        expiries: [
          {
            expiry: '2026-06-27',
            expiryTimestamp: Date.UTC(2026, 5, 27),
            daysToExpiry: 4,
            instrumentCount: 2,
            totalOpenInterest: 10_000_000_000,
            totalVolume24h: 1000,
            callOpenInterest: 9_000_000_000,
            putOpenInterest: 1_000_000_000,
            putCallRatio: 0.11,
            maxPainStrike: 100_000,
            largestCallWall: null,
            largestPutWall: null,
            atmImpliedVolatility: 45,
            skew25Delta: 2,
          },
        ],
        provider: provider('live', false),
        timestamp: Date.now(),
      },
      volatility: {
        asset: 'BTC',
        range: '90d',
        candles: [],
        current: 45,
        rank: 45,
        provider: provider('live', false),
        timestamp: Date.now(),
      },
      fundingRates: [funding('bybit', -0.08, 0)],
      spotTicker: ticker(-4),
    });

    expect(response.regime === 'etf-led').toBe(false);
    expect(response.regimeScore < 55).toBe(true);
  });
});

function provider(source: 'live' | 'snapshot' | 'fallback', stale: boolean) {
  return {
    provider: 'test',
    source,
    ok: source !== 'fallback',
    updatedAt: Date.now(),
    stale,
  };
}

function flow(date: string, totalNetFlowUsd: number) {
  return {
    date,
    asset: 'BTC' as const,
    totalNetFlowUsd,
    cumulativeNetFlowUsd: totalNetFlowUsd,
    fundFlows: { IBIT: totalNetFlowUsd },
    leaderTicker: 'IBIT',
    laggardTicker: 'IBIT',
    anomaly: Math.abs(totalNetFlowUsd) > 250_000_000,
  };
}

function funding(exchange: string, percent: number, openInterest: number): FundingRateData {
  return {
    symbol: 'BTCUSDT.P',
    baseAsset: 'BTC',
    exchange,
    fundingRate: percent / 100,
    fundingRatePercent: percent,
    annualizedRate: percent * 3 * 365,
    nextFundingTime: null,
    markPrice: 100_000,
    indexPrice: 100_000,
    openInterest,
    volume24h: 500_000_000,
    timestamp: Date.now(),
  };
}

function ticker(change: number): Ticker {
  return {
    symbol: 'BTC-USDT',
    exchange: 'bybit',
    type: 'spot',
    bid: 100_000,
    ask: 100_010,
    last: 100_005,
    high24h: 101_000,
    low24h: 98_000,
    volume24h: 10_000,
    quoteVolume24h: 1_000_000_000,
    change24h: 2400,
    percentage24h: change,
    timestamp: Date.now(),
  };
}
