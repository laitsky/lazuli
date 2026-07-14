import { describe, expect, test } from 'bun:test';
import { aggregateRealtimeReports } from './realtime-aggregate';

function report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    environment: 'api-staging.lazuli.now',
    target: 'wss://api-staging.lazuli.now/api/v1/ws?topic=ticker:bybit:btcusdt.p',
    startedAt: '2026-07-14T00:00:00.000Z',
    endedAt: '2026-07-14T01:10:00.000Z',
    passed: true,
    config: { mode: 'load', connections: 500, durationSeconds: 3600, rampSeconds: 600 },
    counters: {
      attempted: 500,
      opened: 500,
      peakOpen: 500,
      openFailures: 0,
      unexpectedCloses: 0,
      sequenceGaps: 0,
      events: 1000,
      latencySamples: 1000,
    },
    latency: { p95Ms: 700 },
    memoryGrowthMiB: 100,
    ...overrides,
  };
}

describe('distributed realtime acceptance aggregation', () => {
  test('passes only a synchronized, lossless 2,000-client result', () => {
    const aggregate = aggregateRealtimeReports([report(), report(), report(), report()], {
      expectedConnections: 2000,
      expectedShards: 4,
      expectedDurationSeconds: 3600,
      maxStartSkewSeconds: 30,
    });
    expect(aggregate.passed).toBe(true);
    expect(aggregate.counters.peakOpen).toBe(2000);
  });

  test('fails on a child error instead of hiding it in totals', () => {
    const failed = report({
      passed: false,
      counters: { ...report().counters, openFailures: 1, peakOpen: 499 },
    });
    const aggregate = aggregateRealtimeReports([report(), report(), report(), failed], {
      expectedConnections: 2000,
      expectedShards: 4,
      expectedDurationSeconds: 3600,
      maxStartSkewSeconds: 30,
    });
    expect(aggregate.passed).toBe(false);
    expect(aggregate.checks.openFailures).toBe(false);
    expect(aggregate.checks.childReports).toBe(false);
  });
});
