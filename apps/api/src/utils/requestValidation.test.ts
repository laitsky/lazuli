import { describe, expect, test } from 'bun:test';
import {
  customIndexSchema,
  multiTimeframeQuerySchema,
  ohlcvBatchSchema,
  ohlcvQuerySchema,
} from './requestValidation';

describe('request validation schemas', () => {
  test('rejects oversized custom indexes and invalid weights', () => {
    expect(
      customIndexSchema.safeParse({
        name: 'Too many assets',
        exchange: 'bybit',
        timeframe: '1h',
        assets: Array.from({ length: 11 }, (_, index) => ({
          symbol: `ASSET${index}-USDT`,
          weight: 1,
        })),
      }).success
    ).toBe(false);

    expect(
      customIndexSchema.safeParse({
        name: 'Invalid weight',
        exchange: 'bybit',
        timeframe: '1h',
        assets: [{ symbol: 'BTC-USDT', weight: 0 }],
      }).success
    ).toBe(false);
  });

  test('rejects malformed symbols and oversized OHLCV batches', () => {
    expect(
      ohlcvBatchSchema.safeParse({
        symbols: ['BTC/USDT'],
        period: '24h',
      }).success
    ).toBe(false);

    expect(
      ohlcvBatchSchema.safeParse({
        symbols: Array.from({ length: 21 }, () => 'BTC-USDT'),
        period: '24h',
      }).success
    ).toBe(false);
  });

  test('rejects invalid date ranges and too many timeframes', () => {
    expect(
      ohlcvQuerySchema.safeParse({
        timeframe: '1h',
        since: 2000,
        until: 1000,
      }).success
    ).toBe(false);

    expect(
      multiTimeframeQuerySchema.safeParse({
        timeframes: '1m,5m,15m,1h,4h,1d,3d,1w,1m',
      }).success
    ).toBe(false);
  });
});
