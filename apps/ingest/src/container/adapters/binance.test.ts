import { describe, expect, test } from 'bun:test';

import { binanceChannelConfiguration, binanceSubscriptionStreams } from './binance.ts';

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
});
