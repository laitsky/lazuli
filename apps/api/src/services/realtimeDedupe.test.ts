import { describe, expect, test } from 'bun:test';
import { BoundedRealtimeEventIndex } from './realtimeDedupe';

describe('realtime event idempotency checkpoint', () => {
  test('restores completed event IDs and suppresses a partial-batch retry', () => {
    const beforeFailure = new BoundedRealtimeEventIndex(4);
    beforeFailure.remember('evt_first', 41);

    const afterRestart = new BoundedRealtimeEventIndex(4);
    afterRestart.restore(beforeFailure.entries());
    expect(afterRestart.get('evt_first')).toBe(41);
    expect(afterRestart.get('evt_failed')).toBe(undefined);

    afterRestart.remember('evt_first', 42);
    expect(afterRestart.get('evt_first')).toBe(41);
    afterRestart.remember('evt_failed', 42);
    expect(afterRestart.get('evt_failed')).toBe(42);
  });

  test('evicts the oldest IDs at the configured bound', () => {
    const index = new BoundedRealtimeEventIndex(2);
    index.remember('evt_1', 1);
    index.remember('evt_2', 2);
    index.remember('evt_3', 3);
    expect(index.entries()).toEqual([
      ['evt_2', 2],
      ['evt_3', 3],
    ]);
  });
});
