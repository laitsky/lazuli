import { describe, expect, test } from 'bun:test';
import { withTimeout } from './timeout';

describe('withTimeout', () => {
  test('returns a completed operation', async () => {
    await expect(withTimeout(Promise.resolve('ready'), 100, 'shard')).resolves.toBe('ready');
  });

  test('bounds an unresponsive operation', async () => {
    const never = new Promise<string>(() => undefined);

    await expect(withTimeout(never, 5, 'binance shard health')).rejects.toThrow(
      'binance shard health timed out after 5ms'
    );
  });
});
