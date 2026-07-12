import { describe, expect, test } from 'bun:test';
import { calculateOpenInterestChanges } from './derivedRollupService';

describe('derived rollup service', () => {
  test('calculates OI changes from actual time-window observations', () => {
    const now = Date.UTC(2026, 6, 11, 12, 0, 0);
    const rows = [
      { bucket_start: now / 1000 - 86_400, value_json: JSON.stringify({ value: 100 }) },
      { bucket_start: now / 1000 - 3_600, value_json: JSON.stringify({ value: 120 }) },
      { bucket_start: now / 1000 - 300, value_json: JSON.stringify({ value: 125 }) },
      {
        bucket_start: now / 1000,
        value_json: JSON.stringify({ value: 150, observedAt: now }),
      },
    ];

    const changes = calculateOpenInterestChanges(rows, now);
    expect(changes?.change5mPercent).toBe(20);
    expect(changes?.change1hPercent).toBe(25);
    expect(changes?.change24hPercent).toBe(50);
    expect(changes?.currentOpenInterestUsd).toBe(150);
  });

  test('returns null windows rather than inventing unavailable history', () => {
    const now = Date.UTC(2026, 6, 11, 12, 0, 0);
    const changes = calculateOpenInterestChanges(
      [{ bucket_start: now / 1000, value_json: JSON.stringify({ value: 150 }) }],
      now
    );
    expect(changes?.change5mPercent).toBe(null);
    expect(changes?.change1hPercent).toBe(null);
    expect(changes?.change24hPercent).toBe(null);
  });
});
