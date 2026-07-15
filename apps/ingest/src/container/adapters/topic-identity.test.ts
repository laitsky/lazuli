import { describe, expect, test } from 'bun:test';
import type { RealtimeEvent } from '@lazuli/shared';

import { BinanceAdapter } from './binance';
import { BybitAdapter, freshBybitLiquidationTimestamp } from './bybit';
import { HyperliquidAdapter } from './hyperliquid';
import { OkxAdapter } from './okx';
import { UpbitAdapter } from './upbit';

type MessageAdapter = { handleMessage(message: string): void };

function emitOne(
  create: (emit: (event: RealtimeEvent) => void) => unknown,
  message: Record<string, unknown>
): RealtimeEvent[] {
  const events: RealtimeEvent[] = [];
  const adapter = create((event) => events.push(event)) as MessageAdapter;
  adapter.handleMessage(JSON.stringify(message));
  return events;
}

describe('adapter realtime topic identity', () => {
  test('marks every derivatives provider topic as perpetual', () => {
    const binance = emitOne((emit) => new BinanceAdapter(['BTC/USDT'], emit), {
      e: 'bookTicker',
      E: 1,
      s: 'BTCUSDT',
      u: 1,
      b: '100',
      a: '101',
    });
    const bybit = emitOne((emit) => new BybitAdapter(['BTC/USDT'], emit), {
      topic: 'tickers.BTCUSDT',
      type: 'delta',
      ts: 1,
      cs: 1,
      data: { symbol: 'BTCUSDT', bid1Price: '100', ask1Price: '101' },
    });
    const okx = emitOne((emit) => new OkxAdapter(['BTC/USDT'], emit), {
      arg: { channel: 'trades', instId: 'BTC-USDT-SWAP' },
      data: [
        {
          instId: 'BTC-USDT-SWAP',
          ts: '1',
          tradeId: '1',
          px: '100',
          sz: '1',
          side: 'buy',
        },
      ],
    });
    const hyperliquid = emitOne((emit) => new HyperliquidAdapter(['BTC/USDT'], emit), {
      channel: 'allMids',
      data: { mids: { BTC: '100' } },
    });

    expect(binance.map((event) => event.topic)).toEqual(['ticker:binance:btcusdt.p']);
    expect(bybit.map((event) => event.topic)).toEqual(['ticker:bybit:btcusdt.p']);
    expect(okx.map((event) => event.topic)).toEqual(['trades:okx:btcusdt.p']);
    expect(hyperliquid.map((event) => event.topic)).toEqual(['ticker:hyperliquid:btcusdt.p']);
  });

  test('keeps Upbit topics on the independently delimited spot identity', () => {
    const events = emitOne((emit) => new UpbitAdapter(['BTC/USDT'], emit, 'KRW'), {
      type: 'ticker',
      code: 'KRW-BTC',
      timestamp: 1,
      trade_price: 100,
      signed_change_rate: 0.01,
    });

    expect(events.map((event) => event.topic)).toEqual(['ticker:upbit:btc-krw']);
  });

  test('rejects retained Bybit liquidations from the live latency stream', () => {
    const now = 1_800_000_000_000;
    expect(freshBybitLiquidationTimestamp(now - 10_000, now)).toBe(true);
    expect(freshBybitLiquidationTimestamp(now - 10_001, now)).toBe(false);
    expect(freshBybitLiquidationTimestamp(now + 5_001, now)).toBe(false);

    const staleEvents: RealtimeEvent[] = [];
    const staleAdapter = new BybitAdapter(['BTC/USDT'], (event) => staleEvents.push(event));
    (staleAdapter as unknown as MessageAdapter).handleMessage(
      JSON.stringify({
        topic: 'allLiquidation.BTCUSDT',
        ts: now,
        data: [{ T: now - 60_000, s: 'BTCUSDT', S: 'Sell', p: '100', v: '1' }],
      })
    );
    expect(staleEvents).toEqual([]);
    expect(staleAdapter.health.staleEventsDiscarded).toBe(1);

    const liveEvents = emitOne((emit) => new BybitAdapter(['BTC/USDT'], emit), {
      topic: 'allLiquidation.BTCUSDT',
      ts: Date.now(),
      data: [{ T: Date.now(), s: 'BTCUSDT', S: 'Sell', p: '100', v: '1' }],
    });
    expect(liveEvents.map((event) => event.topic)).toEqual(['liquidations:bybit:btcusdt.p']);
  });
});
