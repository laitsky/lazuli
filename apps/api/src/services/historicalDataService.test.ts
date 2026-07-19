import { describe, expect, test } from 'bun:test';
import type { HistoricalBackfillQueueMessage } from '../types';
import { ErrorCode, ExchangeError } from '../errors';
import {
  aggregateHistoricalTrades,
  classifyHistoricalFailure,
  dailyObservationTimestamp,
  dailyRefreshWithinTaskBudget,
  dedupeHistoricalRows,
  historicalObjectKey,
  isClosedHistoricalPartition,
  mergeHistoricalRows,
  planHistoricalCampaign,
  validateHistoricalArchiveBody,
} from './historicalDataService';

describe('historical data archives', () => {
  test('fails terminal provider API validation without retrying it as a network reset', () => {
    expect(
      classifyHistoricalFailure(
        new ExchangeError(ErrorCode.EXCHANGE_API_ERROR, 'Illegal time range', 'okx')
      )
    ).toBe('validation');
    expect(
      classifyHistoricalFailure(
        new ExchangeError(ErrorCode.EXCHANGE_TIMEOUT, 'Provider timed out', 'okx')
      )
    ).toBe('provider_network');
  });

  test('preserves explicit symbols without provider discovery', async () => {
    const plan = await planHistoricalCampaign({
      datasets: ['open_interest'],
      exchanges: ['binance'],
      symbols: ['BTCUSDT.P'],
      startTime: Date.UTC(2026, 5, 29),
      cutoffTime: Date.UTC(2026, 5, 30, 23, 59, 59, 999),
      maxSymbolsPerExchange: 1,
    });

    expect(plan.frozenUniverse['binance:perp:1']).toEqual(['BTCUSDT.P']);
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks.every((task) => task.entity === 'BTCUSDT.P')).toBe(true);
  });

  test('limits explicit trade campaigns to the requested market type', async () => {
    const plan = await planHistoricalCampaign({
      datasets: ['trade_aggregate'],
      exchanges: ['okx'],
      symbols: ['BTCUSDT.P'],
      types: ['perp'],
      startTime: Date.UTC(2026, 5, 30),
      cutoffTime: Date.UTC(2026, 5, 30, 23, 59, 59, 999),
      maxSymbolsPerExchange: 1,
    });

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]?.marketType).toBe('perp');
  });

  test('uses the canonical dataset/provider/month object layout', () => {
    const message: HistoricalBackfillQueueMessage = {
      kind: 'history-backfill',
      campaignId: 'campaign',
      componentId: 'component',
      taskId: 'task',
      dataset: 'funding_rate',
      provider: 'bybit',
      exchange: 'bybit',
      entity: 'BTCUSDT.P',
      marketType: 'perp',
      resolution: 'native',
      startTime: Date.UTC(2026, 5, 1),
      endTime: Date.UTC(2026, 5, 30, 23, 59, 59, 999),
    };

    expect(historicalObjectKey(message)).toBe(
      'history/v1/dataset=funding_rate/provider=bybit/exchange=bybit/type=perp/resolution=native/entity=BTCUSDT.P/year=2026/month=06.ndjson.gz'
    );
  });

  test('preserves all catalog and funding-basis rows sharing a timestamp', () => {
    const t = Date.UTC(2026, 6, 1);
    expect(
      dedupeHistoricalRows(
        [
          { t, type: 'spot', symbol: 'BTC-USDT' },
          { t, type: 'spot', symbol: 'ETH-USDT' },
          { t, type: 'spot', symbol: 'BTC-USDT' },
        ],
        'market_catalog'
      )
    ).toHaveLength(2);
    expect(
      dedupeHistoricalRows(
        [
          { t, asset: 'BTC', longExchange: 'okx', shortExchange: 'bybit' },
          { t, asset: 'ETH', longExchange: 'okx', shortExchange: 'bybit' },
        ],
        'funding_basis'
      )
    ).toHaveLength(2);
  });

  test('merges current-month rows without mutating inputs and lets refreshed rows win', () => {
    const first = Date.UTC(2026, 6, 1);
    const second = Date.UTC(2026, 6, 2);
    const existing = [
      { t: first, value: 1 },
      { t: second, value: 2 },
    ];
    const incoming = [
      { t: second, value: 20 },
      { t: Date.UTC(2026, 6, 3), value: 3 },
    ];

    expect(mergeHistoricalRows(existing, incoming, 'macro')).toEqual([
      { t: first, value: 1 },
      { t: second, value: 20 },
      { t: Date.UTC(2026, 6, 3), value: 3 },
    ]);
    expect(existing[1]?.value).toBe(2);
  });

  test('classifies partitions by UTC month and produces retry-stable catalog timestamps', () => {
    const now = Date.UTC(2026, 6, 19, 12);
    expect(isClosedHistoricalPartition(Date.UTC(2026, 5, 30), now)).toBe(true);
    expect(isClosedHistoricalPartition(Date.UTC(2026, 6, 1), now)).toBe(false);
    expect(dailyObservationTimestamp(Date.UTC(2026, 6, 19, 23, 59))).toBe(Date.UTC(2026, 6, 19));
  });

  test('blocks the complete daily run when its planned task count exceeds budget', () => {
    expect(dailyRefreshWithinTaskBudget(10, 10)).toBe(true);
    expect(dailyRefreshWithinTaskBudget(11, 10)).toBe(false);
  });

  test('plans exactly ten tasks for the bounded daily dataset set', async () => {
    const plan = await planHistoricalCampaign({
      datasets: ['macro', 'etf_flow', 'market_catalog'],
      startTime: Date.UTC(2026, 6, 19),
      cutoffTime: Date.UTC(2026, 6, 19, 23, 59, 59, 999),
    });
    expect(plan.estimatedTasks).toBe(10);
  });

  test('rejects archive bodies whose checksum no longer matches the manifest', async () => {
    const body = `${JSON.stringify({ t: Date.UTC(2026, 6, 1), value: 1 })}\n`;
    const checksum = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    expect(await validateHistoricalArchiveBody(body, { checksum, row_count: 1 })).toHaveLength(1);
    await expect(
      validateHistoricalArchiveBody(`${body}corrupt\n`, { checksum, row_count: 2 })
    ).rejects.toThrow(/failed checksum/);
  });

  test('aggregates trades on UTC hour boundaries with native base and quote units', () => {
    const hour = Date.UTC(2026, 6, 1, 10);
    const [row] = aggregateHistoricalTrades([
      { t: hour + 1, side: 'buy', price: 100, amount: 2, cost: 200 },
      { t: hour + 2, side: 'sell', price: 110, amount: 1, cost: 110 },
    ]);
    expect({
      t: row?.t,
      count: row?.count,
      buyBaseVolume: row?.buyBaseVolume,
      sellBaseVolume: row?.sellBaseVolume,
      buyQuoteVolume: row?.buyQuoteVolume,
      sellQuoteVolume: row?.sellQuoteVolume,
      high: row?.high,
      low: row?.low,
      firstPrice: row?.firstPrice,
      lastPrice: row?.lastPrice,
    }).toEqual({
      t: hour,
      count: 2,
      buyBaseVolume: 2,
      sellBaseVolume: 1,
      buyQuoteVolume: 200,
      sellQuoteVolume: 110,
      high: 110,
      low: 100,
      firstPrice: 100,
      lastPrice: 110,
    });
    expect(Math.abs(Number(row?.vwap) - 310 / 3) < 1e-9).toBe(true);
  });

  test('plans bounded one-year monthly options partitions without provider discovery', async () => {
    const plan = await planHistoricalCampaign({
      datasets: ['options_volatility'],
      cutoffTime: Date.UTC(2026, 6, 1) - 1,
    });
    expect(plan.tasks.length >= 24).toBe(true);
    expect(plan.tasks.every((task) => task.dataset === 'options_volatility')).toBe(true);
    expect(plan.components.every((component) => component.tasks <= 5_000)).toBe(true);
  });
});
