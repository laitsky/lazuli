import { describe, expect, test } from 'bun:test';

import { signBatch } from './batch-sink.ts';
import { loadConfig } from './types.ts';

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
    });

    expect(config.apiBaseUrl).toBe('https://api.example.com');
    expect(config.providers).toEqual(['binance', 'bybit']);
    expect(config.symbols[0]).toBe('BTC/USDT');
    expect(config.symbols).toHaveLength(50);
    expect(config.batchSize).toBe(500);
    expect(config.maxBufferedEvents).toBe(10_000);
    expect(config.signingKeyId).toBe('ingest-test-v2');
  });

  test('requires the signing secret before opening provider connections', () => {
    expect(() => loadConfig({ API_BASE_URL: 'https://api.example.com' })).toThrow(
      'INGEST_SIGNING_SECRET is required'
    );
  });
});

describe('API delivery signature', () => {
  test('uses the timestamp-dot-raw-body canonical input', async () => {
    expect(await signBatch('secret', 1_700_000_000_000, '{"events":[]}')).toBe(
      'cc8bd2655edad324dc4cadeb832556332fea28e5264fac1b75526ab2b6d2f16a'
    );
  });
});
