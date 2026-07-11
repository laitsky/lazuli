import { describe, expect, test } from 'bun:test';
import { BoundedMemoryCache } from './memoryCache';

function createCache(options: {
  now?: () => number;
  maxEntries?: number;
  maxBytes?: number;
  maxEntryBytes?: number;
}) {
  return new BoundedMemoryCache({
    maxEntries: options.maxEntries ?? 128,
    maxBytes: options.maxBytes ?? 1024,
    maxEntryBytes: options.maxEntryBytes ?? 512,
    now: options.now,
  });
}

const policy = { ttlMs: 100, staleTtlMs: 500 };

describe('bounded memory cache', () => {
  test('coalesces concurrent refreshes for the same key', async () => {
    const cache = createCache({});
    let calls = 0;
    let release!: (value: { price: number }) => void;
    const pending = new Promise<{ price: number }>((resolve) => {
      release = resolve;
    });
    const loader = () => {
      calls += 1;
      return pending;
    };

    const first = cache.getOrLoad('ticker', policy, loader);
    const second = cache.getOrLoad('ticker', policy, loader);
    expect(calls).toBe(1);
    release({ price: 100 });

    expect((await first).value).toEqual({ price: 100 });
    expect((await second).value).toEqual({ price: 100 });
    expect(calls).toBe(1);
  });

  test('serves fresh entries and refreshes them after TTL expiry', async () => {
    let now = 1_000;
    const cache = createCache({ now: () => now });
    let calls = 0;
    const loader = async () => ({ version: ++calls });

    expect((await cache.getOrLoad('markets', policy, loader)).state).toBe('miss');
    now += 99;
    expect((await cache.getOrLoad('markets', policy, loader)).state).toBe('hit');
    now += 2;
    const refreshed = await cache.getOrLoad('markets', policy, loader);
    expect(refreshed.state).toBe('miss');
    expect(refreshed.value.version).toBe(2);
  });

  test('falls back to stale memory when a refresh fails', async () => {
    let now = 2_000;
    const cache = createCache({ now: () => now });
    await cache.getOrLoad('funding', policy, async () => ({ rate: 0.01 }));
    now += 101;

    const stale = await cache.getOrLoad('funding', policy, async () => {
      throw new Error('exchange unavailable');
    });
    expect(stale.state).toBe('stale');
    expect(stale.value).toEqual({ rate: 0.01 });
    expect(stale.refreshError).toBe('exchange unavailable');
  });

  test('evicts the least recently used entry at the entry limit', async () => {
    const cache = createCache({ maxEntries: 2 });
    await cache.getOrLoad('a', policy, async () => 'a');
    await cache.getOrLoad('b', policy, async () => 'b');
    await cache.getOrLoad('a', policy, async () => 'unused');
    await cache.getOrLoad('c', policy, async () => 'c');

    expect(cache.entryCount).toBe(2);
    expect((await cache.getOrLoad('a', policy, async () => 'reloaded-a')).state).toBe('hit');
    expect((await cache.getOrLoad('b', policy, async () => 'reloaded-b')).state).toBe('miss');
  });

  test('returns but does not retain an oversized entry', async () => {
    const cache = createCache({ maxEntryBytes: 8 });
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return 'this payload is too large';
    };

    expect((await cache.getOrLoad('large', policy, loader)).stored).toBe(false);
    expect((await cache.getOrLoad('large', policy, loader)).stored).toBe(false);
    expect(calls).toBe(2);
    expect(cache.entryCount).toBe(0);
  });
});
