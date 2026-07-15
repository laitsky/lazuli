import { describe, expect, test } from 'bun:test';
import { readinessViolations, type ReadinessSample } from './staging-readiness';

function cleanSample(): ReadinessSample {
  return {
    observedAt: new Date().toISOString(),
    customDomainStatus: 200,
    isolationStatus: 200,
    health: {
      status: 'ready',
      failures: [],
      batching: { publishingEnabled: false, queued: 0, dropped: 0 },
      providers: ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'].map((provider) => ({
        provider,
        state: 'connected',
        freshnessMs: 10,
        staleEventsDiscarded: 0,
        reconnects: 0,
        sequenceGaps: 0,
        unresolvedGaps: 0,
        pendingSnapshots: 0,
        ...(provider === 'binance'
          ? {
              channels: {
                public: { state: 'connected', reconnects: 0 },
                market: { state: 'connected', reconnects: 0 },
              },
            }
          : {}),
      })),
    },
  };
}

describe('staging readiness gate', () => {
  test('accepts a clean disabled-publishing sample', () => {
    expect(readinessViolations(cleanSample())).toEqual([]);
  });

  test('fails closed on drops, gaps, stale feeds, and route failure', () => {
    const sample = cleanSample();
    sample.customDomainStatus = 0;
    const health = sample.health;
    (health.batching as Record<string, unknown>).dropped = 1;
    const providers = health.providers as Array<Record<string, unknown>>;
    providers[0].sequenceGaps = 1;
    providers[1].freshnessMs = 45_000;
    const failures = readinessViolations(sample);
    expect(failures).toContain('custom-domain health is not HTTP 200');
    expect(failures).toContain('ingest has dropped events');
    expect(failures).toContain('binance sequenceGaps is not zero');
    expect(failures).toContain('bybit is stale');
  });
});
