import { describe, expect, test } from 'bun:test';
import { extractRealtimeLatencySample } from './realtime-latency';

describe('realtime client latency sampling', () => {
  test('extracts source-to-client latency from a native liquidation event', () => {
    expect(
      extractRealtimeLatencySample(
        {
          event: {
            type: 'liquidation-print',
            eventId: 'evt_native_1',
            exchangeTimestamp: 1_000,
            ingestedAt: 1_250,
            provenance: { provider: 'Bybit' },
          },
        },
        1_550
      )
    ).toEqual({
      eventId: 'evt_native_1',
      provider: 'bybit',
      sourceToClientMs: 550,
      ingestToClientMs: 300,
    });
  });

  test('rejects modeled, future, and stale observations', () => {
    expect(
      extractRealtimeLatencySample(
        { data: { type: 'liquidation-band', eventId: 'evt_modeled_1', exchangeTimestamp: 1 } },
        500
      )
    ).toBe(null);
    expect(
      extractRealtimeLatencySample(
        {
          data: {
            type: 'liquidation-print',
            eventId: 'evt_future_1',
            exchangeTimestamp: 2_000,
          },
        },
        1_000
      )
    ).toBe(null);
    expect(
      extractRealtimeLatencySample(
        {
          data: {
            type: 'liquidation-print',
            eventId: 'evt_stale_1',
            exchangeTimestamp: 1,
          },
        },
        400_001
      )
    ).toBe(null);
  });
});
