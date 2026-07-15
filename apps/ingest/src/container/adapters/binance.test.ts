import { describe, expect, test } from 'bun:test';

import type { RealtimeEvent, RealtimeTopic } from '@lazuli/shared';

import {
  BinanceAdapter,
  binanceChannelConfiguration,
  binanceSubscriptionStreams,
} from './binance.ts';

class TestBinanceAdapter extends BinanceAdapter {
  receive(message: Record<string, unknown>): void {
    this.handleMessage(JSON.stringify(message));
  }
}

describe('Binance 2026 websocket channel layout', () => {
  test('separates public order-book traffic from market event traffic', () => {
    const config = binanceChannelConfiguration();
    expect(config.publicUrl).toBe('wss://fstream.binance.com/public/ws');
    expect(config.marketUrl).toBe('wss://fstream.binance.com/market/ws');
    expect(config.publicStreams).toEqual(['bookTicker', 'depth@100ms']);
    expect(config.marketStreams).toEqual(['aggTrade', 'forceOrder', 'markPrice@1s']);
    expect(config.publicUrl.endsWith('/public/ws')).toBe(true);
  });

  test('subscribes only rollout-enabled topics and retains a low-rate health stream', () => {
    const restricted = binanceSubscriptionStreams(
      ['BTC/USDT', 'ETH/USDT'],
      new Set(['ticker:bybit:btcusdt.p', 'trades:okx:btcusdt.p'])
    );
    expect(restricted.publicStreams).toEqual(['btcusdt@bookTicker']);
    expect(restricted.marketStreams).toEqual(['btcusdt@markPrice@1s']);

    const unrestricted = binanceSubscriptionStreams(['BTC/USDT'], null);
    expect(unrestricted.publicStreams).toEqual(['btcusdt@bookTicker', 'btcusdt@depth@100ms']);
    expect(unrestricted.marketStreams).toEqual([
      'btcusdt@aggTrade',
      'btcusdt@forceOrder',
      'btcusdt@markPrice@1s',
    ]);
  });

  test('uses disabled fallback streams for freshness without entering fan-out', () => {
    const emitted: RealtimeEvent[] = [];
    const allowlist = new Set<RealtimeTopic>(['ticker:bybit:btcusdt.p']);
    const adapter = new TestBinanceAdapter(['BTC/USDT'], (event) => emitted.push(event), allowlist);

    adapter.receive({
      e: 'bookTicker',
      E: 1_700_000_000_000,
      s: 'BTCUSDT',
      u: 1,
      b: '60000',
      a: '60001',
    });
    adapter.receive({
      e: 'markPriceUpdate',
      E: 1_700_000_000_001,
      s: 'BTCUSDT',
      p: '60000.5',
      r: '0.0001',
      T: 1_700_003_600_000,
    });

    expect(emitted).toEqual([]);
  });
});
