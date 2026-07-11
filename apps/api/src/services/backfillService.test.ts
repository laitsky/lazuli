import { describe, expect, test } from 'bun:test';
import {
  archiveKey,
  assertBackfillTaskLimit,
  backfillFailureStatus,
  buildBackfillTasks,
  DEFAULT_BACKFILL_END,
  DEFAULT_BACKFILL_START,
  DEFAULT_BACKFILL_TIMEFRAMES,
  gzipNdjsonForTest,
  MAX_BACKFILL_ATTEMPTS,
  MAX_BACKFILL_TASKS,
  prepareBackfillUniverse,
  queueRetryDelaySeconds,
  splitMonths,
} from './backfillService';

describe('backfill service planning helpers', () => {
  test('uses the full Cloudflare archive default universe when symbols are explicit', async () => {
    const universe = await prepareBackfillUniverse({ symbols: ['BTC-USDT'] });

    expect(universe.exchanges).toEqual(['binance', 'bybit', 'okx', 'hyperliquid', 'upbit']);
    expect(universe.timeframes).toEqual(DEFAULT_BACKFILL_TIMEFRAMES);
    expect(universe.startTime).toBe(DEFAULT_BACKFILL_START);
    expect(universe.endTime).toBe(DEFAULT_BACKFILL_END);
    expect(universe.typesByExchange.hyperliquid).toEqual(['perp']);
    expect(universe.typesByExchange.upbit).toEqual(['spot']);

    const tasks = buildBackfillTasks('job', universe);
    const exchangeTypePairs = Object.values(universe.typesByExchange).reduce(
      (sum, types) => sum + types.length,
      0
    );
    const monthCount = splitMonths(DEFAULT_BACKFILL_START, DEFAULT_BACKFILL_END).length;
    expect(tasks).toHaveLength(exchangeTypePairs * DEFAULT_BACKFILL_TIMEFRAMES.length * monthCount);
  });

  test('rejects invalid exchanges, unsupported type combinations, and invalid ranges', async () => {
    await expect(
      prepareBackfillUniverse({ exchanges: ['coinbase'], symbols: ['BTC-USDT'] })
    ).rejects.toThrow("Unsupported exchange 'coinbase'");
    await expect(
      prepareBackfillUniverse({
        exchanges: ['hyperliquid'],
        types: ['spot'],
        symbols: ['BTC-USDT'],
      })
    ).rejects.toThrow("Exchange 'hyperliquid' does not support: spot");
    await expect(
      prepareBackfillUniverse({
        symbols: ['BTC-USDT'],
        startTime: DEFAULT_BACKFILL_END,
        endTime: DEFAULT_BACKFILL_START,
      })
    ).rejects.toThrow('valid startTime before endTime');
  });

  test('splits inclusive date ranges by UTC month', () => {
    const months = splitMonths(
      Date.parse('2020-01-15T00:00:00Z'),
      Date.parse('2020-03-02T00:00:00Z')
    );

    expect(months).toEqual([
      {
        start: Date.parse('2020-01-15T00:00:00Z'),
        end: Date.parse('2020-02-01T00:00:00Z') - 1,
      },
      {
        start: Date.parse('2020-02-01T00:00:00Z'),
        end: Date.parse('2020-03-01T00:00:00Z') - 1,
      },
      {
        start: Date.parse('2020-03-01T00:00:00Z'),
        end: Date.parse('2020-03-02T00:00:00Z'),
      },
    ]);
  });

  test('generates canonical gzipped R2 archive keys', () => {
    expect(
      archiveKey({
        jobId: 'job',
        taskId: 'task',
        exchange: 'binance',
        symbol: 'BTC-USDT',
        type: 'spot',
        timeframe: '1h',
        startTime: Date.parse('2020-02-01T00:00:00Z'),
        endTime: Date.parse('2020-02-29T23:59:59Z'),
      })
    ).toBe(
      'ohlcv/v1/exchange=binance/type=spot/timeframe=1h/symbol=BTC-USDT/year=2020/month=02.ndjson.gz'
    );
  });

  test('round-trips gzipped NDJSON payloads', async () => {
    const ndjson = '{"t":1,"o":2,"h":3,"l":1,"c":2,"v":10}\n';
    await expect(gzipNdjsonForTest(ndjson)).resolves.toBe(ndjson);
  });

  test('keeps retryable failures pending until the terminal attempt', () => {
    expect(MAX_BACKFILL_ATTEMPTS).toBe(5);
    expect(backfillFailureStatus(1)).toBe('pending');
    expect(backfillFailureStatus(MAX_BACKFILL_ATTEMPTS - 1)).toBe('pending');
    expect(backfillFailureStatus(MAX_BACKFILL_ATTEMPTS)).toBe('failed');
  });

  test('caps task fan-out and uses bounded exponential queue delays', () => {
    assertBackfillTaskLimit(MAX_BACKFILL_TASKS);
    let limitError = '';
    try {
      assertBackfillTaskLimit(MAX_BACKFILL_TASKS + 1);
    } catch (error) {
      limitError = error instanceof Error ? error.message : String(error);
    }
    expect(limitError.includes('5000 task limit')).toBe(true);
    expect([1, 2, 3, 4, 5, 20].map(queueRetryDelaySeconds)).toEqual([10, 20, 40, 80, 160, 300]);
  });
});
