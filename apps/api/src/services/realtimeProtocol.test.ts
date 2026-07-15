import { describe, expect, test } from 'bun:test';

import {
  REALTIME_V2_PROTOCOL,
  acceptsRealtimeV2,
  createBatchEnvelope,
  filterAcceptedRealtimeEvents,
  realtimeEventId,
  timingSafeStringEqual,
  type CanonicalRealtimeEnvelope,
} from './realtimeProtocol';

describe('realtime v2 protocol', () => {
  test('negotiates v2 from a WebSocket subprotocol list', () => {
    expect(acceptsRealtimeV2(`other, ${REALTIME_V2_PROTOCOL}`)).toBe(true);
    expect(acceptsRealtimeV2('lazuli.realtime.v1')).toBe(false);
    expect(acceptsRealtimeV2(null)).toBe(false);
  });

  test('creates a bounded canonical sequence range', () => {
    const events = [11, 12].map(
      (sequence) =>
        ({
          type: 'event',
          topic: 'trades:bybit:btcusdt',
          sequence,
          event: { eventId: `event-${sequence}` },
          data: { eventId: `event-${sequence}` },
          publishedAt: 1_700_000_000_000 + sequence,
        }) satisfies CanonicalRealtimeEnvelope
    );
    const batch = createBatchEnvelope('trades:bybit:btcusdt', events);
    expect(batch.type).toBe('batch');
    expect(batch.firstSequence).toBe(11);
    expect(batch.lastSequence).toBe(12);
    expect(batch.events).toEqual(events);
  });

  test('accepts only bounded safe event identifiers', () => {
    expect(realtimeEventId({ eventId: 'bybit:trade:12345' })).toBe('bybit:trade:12345');
    expect(realtimeEventId({ eventId: 'short' })).toBe(null);
    expect(realtimeEventId({ eventId: 'bad value with spaces' })).toBe(null);
  });

  test('selects each sequencer-accepted event exactly once', () => {
    const events = [
      { eventId: 'bybit:trade:12345', price: 100 },
      { eventId: 'bybit:trade:12345', price: 101 },
      { eventId: 'bybit:trade:67890', price: 102 },
      { eventId: 'bybit:trade:ignored', price: 103 },
    ];
    expect(
      filterAcceptedRealtimeEvents(events, ['bybit:trade:12345', 'bybit:trade:67890'])
    ).toEqual([events[0], events[2]]);
  });

  test('compares secrets without a prefix match', () => {
    expect(timingSafeStringEqual('same-secret', 'same-secret')).toBe(true);
    expect(timingSafeStringEqual('same-secret', 'same-secrex')).toBe(false);
    expect(timingSafeStringEqual('short', 'longer')).toBe(false);
  });
});
