import { describe, expect, test } from 'bun:test';

import { signBatch } from './batch-sink.ts';
import { loadConfig, providerFreshnessMs } from './types.ts';

describe('ingest configuration', () => {
  test('normalizes, deduplicates, and bounds public configuration', () => {
    const symbols = Array.from({ length: 60 }, (_, index) => `asset${index}/usdt`).join(',');
    const config = loadConfig({
      API_BASE_URL: 'https://api.example.com/',
      INGEST_SIGNING_SECRET: 'test-secret',
      INGEST_SIGNING_SECRET_ID: 'ingest-test-v2',
      INGEST_PROVIDERS: 'BINANCE,unknown,bybit,binance',
      INGEST_SYMBOLS: `btc/usdt,BTC/USDT,${symbols}`,
      INGEST_BATCH_SIZE: '999',
      INGEST_MAX_BUFFERED_EVENTS: '-1',
      INGEST_TOPIC_ALLOWLIST:
        'TRADES:BINANCE:BTCUSDT.P,invalid,ticker:bybit:btcusdt.p,trades:binance:btcusdt.p',
    });

    expect(config.apiBaseUrl).toBe('https://api.example.com');
    expect(config.providers).toEqual(['binance', 'bybit']);
    expect(config.symbols[0]).toBe('BTC/USDT');
    expect(config.symbols).toHaveLength(50);
    expect(config.batchSize).toBe(500);
    expect(config.batchIntervalMs).toBe(400);
    expect(config.maxBufferedEvents).toBe(10_000);
    expect(config.publishEnabled).toBe(true);
    expect(config.signingKeyId).toBe('ingest-test-v2');
    expect([...config.topicAllowlist!]).toEqual([
      'trades:binance:btcusdt.p',
      'ticker:bybit:btcusdt.p',
    ]);
  });

  test('supports an explicit deployment-audited publishing stop', () => {
    const config = loadConfig({
      API_BASE_URL: 'https://api.example.com',
      INGEST_SIGNING_SECRET: 'test-secret',
      REALTIME_PUBLISH_ENABLED: 'false',
    });

    expect(config.publishEnabled).toBe(false);
    expect(config.topicAllowlist).toBe(null);
  });

  test('treats an explicitly empty rollout allowlist as deny all', () => {
    const config = loadConfig({
      API_BASE_URL: 'https://api.example.com',
      INGEST_SIGNING_SECRET: 'test-secret',
      INGEST_TOPIC_ALLOWLIST: '',
    });

    expect(config.topicAllowlist).toEqual(new Set());
  });

  test('requires the signing secret before opening provider connections', () => {
    expect(() => loadConfig({ API_BASE_URL: 'https://api.example.com' })).toThrow(
      'INGEST_SIGNING_SECRET is required'
    );
  });

  test('uses upstream messages for health-only rollout streams', () => {
    expect(providerFreshnessMs({ lastEventAt: null, lastMessageAt: 900 }, 1_000)).toBe(100);
    expect(providerFreshnessMs({ lastEventAt: 800, lastMessageAt: 950 }, 1_000)).toBe(200);
    expect(providerFreshnessMs({ lastEventAt: null, lastMessageAt: null }, 1_000)).toBeNull();
  });
});

describe('API delivery signature', () => {
  test('uses the timestamp-dot-raw-body canonical input', async () => {
    expect(await signBatch('secret', 1_700_000_000_000, '{"events":[]}')).toBe(
      'cc8bd2655edad324dc4cadeb832556332fea28e5264fac1b75526ab2b6d2f16a'
    );
  });
});
