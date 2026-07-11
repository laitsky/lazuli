import { describe, expect, test } from 'bun:test';
import {
  buildBacktestIdempotencyKey,
  createDefaultStrategy,
  parseUtcDateRange,
} from './signal-strategy';

describe('Signal Lab strategy contracts', () => {
  test('labels the contrarian scanner fallback as mean-reversion', () => {
    const strategy = createDefaultStrategy('BTC', 'contrarian');
    expect(strategy.mode).toBe('mean-reversion');
    expect(strategy.fastPeriod < strategy.slowPeriod).toBe(true);
    expect(strategy.rsiOversold < strategy.rsiOverbought).toBe(true);
  });

  test('uses inclusive UTC boundaries for archive jobs', () => {
    const range = parseUtcDateRange('2025-01-01', '2025-01-31');
    expect(range.startTime).toBe(Date.UTC(2025, 0, 1));
    expect(range.endTime).toBe(Date.UTC(2025, 1, 1) - 1);
  });

  test('rejects reversed and malformed ranges while allowing one full UTC day', () => {
    let reversedThrew = false;
    let malformedThrew = false;
    try {
      parseUtcDateRange('2025-02-01', '2025-01-01');
    } catch {
      reversedThrew = true;
    }
    try {
      parseUtcDateRange('not-a-date', '2025-01-01');
    } catch {
      malformedThrew = true;
    }
    expect(reversedThrew).toBe(true);
    expect(malformedThrew).toBe(true);
    expect(parseUtcDateRange('2025-01-01', '2025-01-01').endTime).toBe(Date.UTC(2025, 0, 2) - 1);
  });

  test('keeps retries idempotent for one immutable version and range', () => {
    const key = buildBacktestIdempotencyKey('sig_123', 100, 200);
    expect(key).toBe('signal-lab:sig_123:100:200');
    expect(buildBacktestIdempotencyKey('sig_123', 100, 200)).toBe(key);
  });
});
