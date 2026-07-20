import { describe, expect, test } from 'bun:test';
import type { SignalCalibration, Ticker } from '@lazuli/shared';
import type { Env } from '../types';
import {
  applyCalibration,
  buildConvictionOpportunities,
  buildMarketReplay,
  calibrationForExposure,
  enrichOpportunityOpenInterest,
  hydrateOpportunityCalibrations,
  marketReplayNeedsRefresh,
  resolveOpportunityOutcome,
  validateOutcomeCandleCoverage,
} from './convictionEngineService';

function ticker(
  symbol: string,
  percentage24h: number,
  quoteVolume24h: number,
  timestamp: number
): Ticker {
  return {
    exchange: 'bybit',
    symbol,
    type: 'perp',
    bid: 99,
    ask: 101,
    last: 100,
    high24h: 105,
    low24h: 90,
    volume24h: 1_000_000,
    quoteVolume24h,
    change24h: percentage24h,
    percentage24h,
    timestamp,
    openInterest: quoteVolume24h / 2,
  };
}

describe('conviction engine', () => {
  test('normalizes the scanned universe without saturating scores at 100', () => {
    const now = 1_800_000_000_000;
    const response = buildConvictionOpportunities({
      exchange: 'bybit',
      marketType: 'perp',
      now,
      tickers: [
        ticker('BTCUSDT.P', 18, 1_000_000_000, now),
        ticker('ETHUSDT.P', 7, 500_000_000, now),
        ticker('SOLUSDT.P', -4, 100_000_000, now),
      ],
    });

    expect(response.items.length).toBe(3);
    expect(response.items.every((item) => item.score <= 98)).toBe(true);
    expect(new Set(response.items.map((item) => item.score)).size > 1).toBe(true);
    expect(response.model.probabilitySampleMinimum).toBe(100);
    expect(response.items.find((item) => item.symbol === 'BTCUSDT.P')?.calibration.regime).toBe(
      'high-volatility'
    );
  });

  test('displays crowded positive funding as opposing evidence for a long setup', () => {
    const now = 1_800_000_000_000;
    const [opportunity] = buildConvictionOpportunities({
      exchange: 'bybit',
      marketType: 'perp',
      now,
      tickers: [ticker('BTCUSDT.P', 5, 1_000_000_000, now)],
      fundingRates: [
        {
          symbol: 'BTCUSDT.P',
          baseAsset: 'BTC',
          exchange: 'bybit',
          fundingRate: 0.0003,
          fundingRatePercent: 0.03,
          annualizedRate: 32.85,
          nextFundingTime: null,
          markPrice: 100,
          indexPrice: 100,
          openInterest: 500_000_000,
          volume24h: 1_000_000_000,
          timestamp: now,
        },
      ],
    }).items;

    expect(opportunity?.direction).toBe('long');
    expect(opportunity?.evidence.find((item) => item.metric === 'funding_rate')?.contribution).toBe(
      'bearish'
    );
  });

  test('penalizes stale evidence instead of silently changing direction', () => {
    const now = 1_800_000_000_000;
    const build = (timestamp: number) =>
      buildConvictionOpportunities({
        exchange: 'bybit',
        marketType: 'perp',
        now,
        tickers: [ticker('BTCUSDT.P', 6, 1_000_000_000, timestamp)],
      }).items[0]!;
    const fresh = build(now);
    const stale = build(now - 60 * 60_000);

    expect(stale.direction).toBe(fresh.direction);
    expect(stale.score < fresh.score).toBe(true);
    expect(stale.evidence.every((item) => item.freshness === 'stale')).toBe(true);
  });

  test('adds observed open-interest change as supporting or opposing evidence', () => {
    const now = 1_800_000_000_000;
    const response = buildConvictionOpportunities({
      exchange: 'bybit',
      marketType: 'perp',
      now,
      tickers: [ticker('BTCUSDT.P', 6, 1_000_000_000, now)],
    });
    const enriched = enrichOpportunityOpenInterest(
      response,
      new Map([
        [
          'bybit:BTCUSDT.P',
          { change1hPercent: 2.5, currentOpenInterestUsd: 500_000_000, observedAt: now },
        ],
      ]),
      now
    );
    const evidence = enriched.items[0]?.evidence.find(
      (item) => item.metric === 'open_interest_change'
    );

    expect(evidence?.contribution).toBe('bullish');
    expect((enriched.items[0]?.score ?? 0) > (response.items[0]?.score ?? 0)).toBe(true);
  });

  test('keeps probability hidden until a calibration is explicitly marked calibrated', () => {
    const opportunity = buildConvictionOpportunities({
      exchange: 'bybit',
      marketType: 'perp',
      now: 1_800_000_000_000,
      tickers: [ticker('BTCUSDT.P', 6, 1_000_000_000, 1_800_000_000_000)],
    }).items[0]!;
    const experimental: SignalCalibration = {
      ...opportunity.calibration,
      status: 'experimental',
      sampleSize: 99,
      probability: null,
    };
    const calibrated: SignalCalibration = {
      ...experimental,
      status: 'calibrated',
      sampleSize: 100,
      probability: 0.61,
      hitRate: 0.61,
      lowerReturnPercent: -1,
      medianReturnPercent: 1.5,
      upperReturnPercent: 4,
    };

    expect(applyCalibration(opportunity, experimental).calibration.probability).toBe(null);
    expect(applyCalibration(opportunity, calibrated).calibration.probability).toBe(0.61);
    expect(applyCalibration(opportunity, calibrated).expectedMove.medianPercent).toBe(1.5);
    expect(calibrationForExposure({}, calibrated).status).toBe('experimental');
    expect(calibrationForExposure({}, calibrated).probability).toBe(null);
    expect(
      calibrationForExposure({ CONVICTION_PROBABILITIES_ENABLED: 'true' }, calibrated).probability
    ).toBe(0.61);
  });

  test('calibrates only from outcomes created before the opportunity and discloses failed coverage', async () => {
    const opportunity = buildConvictionOpportunities({
      exchange: 'bybit',
      marketType: 'perp',
      now: 1_800_000_000_000,
      tickers: [ticker('BTCUSDT.P', 6, 1_000_000_000, 1_800_000_000_000)],
    }).items[0]!;
    const bound: unknown[][] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind(...values: unknown[]) {
              bound.push(values);
              if (sql.includes('signal_calibration_artifacts')) {
                return sql.includes('SELECT id, calibration_json')
                  ? { all: async () => ({ results: [] }) }
                  : { first: async () => null };
              }
              return {
                all: async () => ({
                  results: [
                    {
                      net_return_percent: 2,
                      max_adverse_excursion_percent: 1,
                      won: 1,
                      coverage_state: 'complete',
                    },
                    {
                      net_return_percent: null,
                      max_adverse_excursion_percent: null,
                      won: null,
                      coverage_state: 'failed',
                    },
                  ],
                }),
              };
            },
          };
        },
      },
    } as unknown as Pick<Env, 'DB' | 'CONVICTION_PROBABILITIES_ENABLED'>;

    const hydrated = await hydrateOpportunityCalibrations(env, {
      items: [opportunity],
      count: 1,
      generatedAt: opportunity.createdAt,
      sourceHealth: {
        status: 'live',
        sources: [{ name: 'test', status: 'live', itemCount: 1, message: null }],
      },
      model: {
        id: 'lazuli-conviction-v1',
        explainable: true,
        probabilitySampleMinimum: 100,
      },
    });

    expect(bound.at(-1)?.at(-1)).toBe(Math.floor(opportunity.createdAt / 1000));
    expect(hydrated.items[0]?.calibration.sampleSize).toBe(1);
    expect(hydrated.items[0]?.calibration.coveragePercent).toBe(50);
    expect(hydrated.items[0]?.calibration.probability).toBe(null);
  });

  test('resolves directional outcomes net of fees, funding, and slippage idempotently', async () => {
    const bound: unknown[][] = [];
    const env = {
      DB: {
        prepare() {
          return {
            bind(...values: unknown[]) {
              bound.push(values);
              return { run: async () => ({ meta: { changes: 1 } }) };
            },
          };
        },
      },
    } as unknown as Pick<Env, 'DB'>;
    const resolved = await resolveOpportunityOutcome(
      env,
      {
        opportunity_id: 'opp_1',
        exchange: 'bybit',
        symbol: 'BTCUSDT.P',
        market_type: 'perp',
        direction: 'long',
        horizon: '6h',
        entry_price: 100,
        fee_bps: 10,
        funding_bps: 2,
        slippage_bps: 3,
        created_at: 1_799_978_400,
      },
      102,
      1_800_000_000_000,
      { high: 104, low: 99 }
    );

    expect(resolved).toBe(true);
    expect(bound[0]?.[1]).toBe(2);
    expect(bound[0]?.[2]).toBe(1.85);
    expect(bound[0]?.[3]).toBe(4);
    expect(bound[0]?.[4]).toBe(1);
  });

  test('rejects partial walk-forward coverage even when multiple candles exist', () => {
    const start = 1_800_000_000_000;
    const timeframe = 5 * 60_000;
    const end = start + 60 * 60_000;
    const candle = (timestamp: number) => ({
      timestamp,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
    });
    const partial = validateOutcomeCandleCoverage(
      [candle(start), candle(start + timeframe)],
      start,
      end,
      timeframe
    );
    const complete = validateOutcomeCandleCoverage(
      Array.from({ length: 13 }, (_, index) => candle(start + index * timeframe)),
      start,
      end,
      timeframe
    );

    expect(partial.complete).toBe(false);
    expect(partial.reason?.includes('2/13')).toBe(true);
    expect(complete.complete).toBe(true);
  });

  test('centers price and volume candles in a replay alongside derived evidence', async () => {
    const opportunity = buildConvictionOpportunities({
      exchange: 'bybit',
      marketType: 'perp',
      now: 1_800_000_000_000,
      tickers: [ticker('BTCUSDT.P', 6, 1_000_000_000, 1_800_000_000_000)],
    }).items[0]!;
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return this;
            },
            async all() {
              return { results: [] };
            },
          };
        },
      },
    } as unknown as Pick<Env, 'DB'>;
    const replay = await buildMarketReplay(env, opportunity, '1h', [
      {
        timestamp: opportunity.createdAt - 60_000,
        open: 99,
        high: 101,
        low: 98,
        close: 100,
        volume: 20,
      },
      { timestamp: opportunity.createdAt, open: 100, high: 103, low: 99, close: 102, volume: 30 },
      {
        timestamp: opportunity.createdAt + 60_000,
        open: 102,
        high: 104,
        low: 101,
        close: 103,
        volume: 40,
      },
    ]);

    expect(replay.series.find((series) => series.metric === 'price')?.points).toHaveLength(3);
    expect(replay.series.find((series) => series.metric === 'volume_ratio')?.points).toHaveLength(
      3
    );
    expect(marketReplayNeedsRefresh(replay, replay.createdAt + 6 * 60_000)).toBe(true);
    expect(marketReplayNeedsRefresh(replay, replay.createdAt + 60_000)).toBe(false);
  });
});
