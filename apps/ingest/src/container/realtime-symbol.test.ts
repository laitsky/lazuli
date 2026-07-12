import { describe, expect, test } from 'bun:test';
import { buildRealtimeTopic, canonicalRealtimeSymbol } from '@lazuli/shared';

describe('shared realtime market identity', () => {
  test('normalizes spot and perpetual notation without collapsing market type', () => {
    expect(canonicalRealtimeSymbol('BTC/USDT', 'spot')).toBe('BTC-USDT');
    expect(canonicalRealtimeSymbol('BTC-USDT', 'spot')).toBe('BTC-USDT');
    expect(canonicalRealtimeSymbol('BTCUSDT.P', 'perp')).toBe('BTCUSDT.P');
    expect(canonicalRealtimeSymbol('BTC/USDT:USDT', 'perp')).toBe('BTCUSDT.P');
  });

  test('builds the same perpetual topic for every provider notation', () => {
    for (const exchange of ['binance', 'bybit', 'okx', 'hyperliquid'] as const) {
      expect(buildRealtimeTopic('trades', exchange, 'BTC/USDT', 'perp')).toBe(
        `trades:${exchange}:btcusdt.p`
      );
      expect(buildRealtimeTopic('trades', exchange, 'BTCUSDT.P', 'perp')).toBe(
        `trades:${exchange}:btcusdt.p`
      );
    }
  });

  test('normalizes Upbit spot identity independently', () => {
    expect(buildRealtimeTopic('ticker', 'upbit', 'BTC-KRW', 'spot')).toBe('ticker:upbit:btc-krw');
    expect(buildRealtimeTopic('ticker', 'upbit', 'BTCKRW', 'spot')).toBe('ticker:upbit:btc-krw');
  });
});
