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

describe('BatchSink topic lanes', () => {
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
      queued: 0,
      dropped: 0,
      batchesSent: 0,
    });
  });
});
