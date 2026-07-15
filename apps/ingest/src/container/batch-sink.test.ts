import { afterEach, describe, expect, test } from 'bun:test';
import type { RealtimeEvent, RealtimeTopic } from '@lazuli/shared';

import { BatchSink } from './batch-sink';
import type { IngestConfig } from './types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function config(): IngestConfig {
  return {
    environment: 'test',
    apiBaseUrl: 'https://api.test',
    signingSecret: 'test-signing-secret',
    signingKeyId: 'test-key-v1',
    providers: ['binance'],
    symbols: ['BTC/USDT'],
    upbitQuote: 'KRW',
    port: 8080,
    batchSize: 500,
    batchIntervalMs: 5_000,
    maxBufferedEvents: 10_000,
    publishEnabled: true,
    topicAllowlist: null,
    controlApiToken: null,
  };
}

function trade(topic: RealtimeTopic, sequence: number): RealtimeEvent {
  return {
    schemaVersion: 1,
    type: 'trade',
    eventId: `event-${sequence}-${topic}`,
    sequence,
    topic: topic as `trades:binance:${string}`,
    exchangeTimestamp: sequence,
    ingestedAt: sequence,
    publishedAt: sequence,
    provenance: {
      kind: 'exchange-native',
      provider: 'binance',
      quality: 'live',
      upstreamSequence: sequence,
    },
    payload: {
      exchange: 'binance',
      symbol: topic.endsWith('ethusdt.p') ? 'ETHUSDT' : 'BTCUSDT',
      tradeId: String(sequence),
      price: 100,
      quantity: 1,
      side: 'buy',
    },
  };
}

function liquidation(sequence: number): RealtimeEvent {
  return {
    schemaVersion: 1,
    type: 'liquidation-print',
    eventId: `liquidation-${sequence}`,
    sequence,
    topic: 'liquidations:bybit:btcusdt.p',
    exchangeTimestamp: sequence,
    ingestedAt: sequence,
    publishedAt: sequence,
    provenance: {
      kind: 'exchange-native',
      provider: 'bybit',
      quality: 'live',
      upstreamSequence: sequence,
    },
    payload: {
      exchange: 'bybit',
      symbol: 'BTCUSDT',
      side: 'long',
      price: 100,
      quantity: 1,
      notionalUsd: 100,
    },
  };
}

describe('BatchSink topic lanes', () => {
  test('flushes an upstream liquidation burst without waiting for the generic interval', async () => {
    const payloads: RealtimeEvent[][] = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      payloads.push((JSON.parse(String(init?.body)) as { events: RealtimeEvent[] }).events);
      return Response.json({ success: true });
    }) as typeof fetch;

    const sink = new BatchSink(config(), () => []);
    sink.start();
    sink.enqueue(liquidation(1));
    sink.enqueue(liquidation(2));
    await Bun.sleep(80);
    sink.stop();

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.map((event) => event.sequence)).toEqual([1, 2]);
    expect(sink.getHealth()).toMatchObject({ queued: 0, dropped: 0, batchesSent: 1 });
  });

  test('does not accelerate high-volume trade lanes', async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json({ success: true });
    }) as unknown as typeof fetch;

    const sink = new BatchSink(config(), () => []);
    sink.start();
    sink.enqueue(trade('trades:binance:btcusdt.p', 1));
    await Bun.sleep(80);
    sink.stop();

    expect(requests).toBe(0);
    expect(sink.getHealth()).toMatchObject({ queued: 1, dropped: 0, batchesSent: 0 });
  });

  test('flushes independent topics concurrently while retaining per-topic order', async () => {
    let active = 0;
    let maxActive = 0;
    const payloads: RealtimeEvent[][] = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const body = JSON.parse(String(init?.body)) as { events: RealtimeEvent[] };
      payloads.push(body.events);
      await Bun.sleep(25);
      active -= 1;
      return Response.json({ success: true });
    }) as typeof fetch;

    const sink = new BatchSink(config(), () => []);
    sink.enqueue(trade('trades:binance:btcusdt.p', 1));
    sink.enqueue(trade('trades:binance:btcusdt.p', 2));
    sink.enqueue(trade('trades:binance:ethusdt.p', 1));
    sink.enqueue(trade('trades:binance:ethusdt.p', 2));

    await sink.flush();

    expect(maxActive).toBe(2);
    expect(payloads).toHaveLength(2);
    expect(payloads.map((events) => events.map((event) => event.sequence)).sort()).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(payloads.every((events) => new Set(events.map((event) => event.topic)).size === 1)).toBe(
      true
    );
    expect(sink.getHealth()).toMatchObject({ queued: 0, dropped: 0, batchesSent: 2 });
  });

  test('rejects new events at the global bound without evicting queued sequence history', () => {
    const bounded = { ...config(), maxBufferedEvents: 2 };
    const sink = new BatchSink(bounded, () => []);
    sink.enqueue(trade('trades:binance:btcusdt.p', 1));
    sink.enqueue(trade('trades:binance:btcusdt.p', 2));
    sink.enqueue(trade('trades:binance:btcusdt.p', 3));

    expect(sink.getHealth()).toMatchObject({ queued: 2, dropped: 1, batchesSent: 0 });
  });

  test('filters deployment-disabled topics before buffering or API delivery', async () => {
    const payloads: RealtimeEvent[][] = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      payloads.push((JSON.parse(String(init?.body)) as { events: RealtimeEvent[] }).events);
      return Response.json({ success: true });
    }) as typeof fetch;
    const sink = new BatchSink(
      {
        ...config(),
        topicAllowlist: new Set(['trades:binance:btcusdt.p']),
      },
      () => []
    );

    sink.enqueue(trade('trades:binance:ethusdt.p', 1));
    sink.enqueue(trade('trades:binance:btcusdt.p', 2));
    await sink.flush();

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.map((event) => event.topic)).toEqual(['trades:binance:btcusdt.p']);
    expect(sink.getHealth()).toMatchObject({
      topicAllowlist: ['trades:binance:btcusdt.p'],
      filtered: 1,
      queued: 0,
      dropped: 0,
      batchesSent: 1,
    });
  });

  test('keeps provider health active without buffering when publishing is disabled', async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json({ success: true });
    }) as unknown as typeof fetch;
    const sink = new BatchSink({ ...config(), publishEnabled: false }, () => []);

    sink.start();
    sink.enqueue(trade('trades:binance:btcusdt.p', 1));
    await sink.flush();

    expect(requests).toBe(0);
    expect(sink.getHealth()).toMatchObject({
      publishingEnabled: false,
      filtered: 0,
      queued: 0,
      dropped: 0,
      batchesSent: 0,
    });
  });
});
