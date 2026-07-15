import { describe, expect, test } from 'bun:test';

import { binanceChannelConfiguration } from './binance.ts';

describe('Binance 2026 websocket channel layout', () => {
  test('separates public order-book traffic from market event traffic', () => {
    const config = binanceChannelConfiguration();
    expect(config.publicUrl).toBe('wss://fstream.binance.com/public/ws');
    expect(config.marketUrl).toBe('wss://fstream.binance.com/market/ws');
    expect(config.publicStreams).toEqual(['bookTicker', 'depth@100ms']);
    expect(config.marketStreams).toEqual(['aggTrade', 'forceOrder', 'markPrice@1s']);
    expect(config.publicUrl.endsWith('/public/ws')).toBe(true);
  });
});
