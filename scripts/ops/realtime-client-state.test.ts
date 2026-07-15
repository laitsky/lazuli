import { describe, expect, test } from 'bun:test';
import {
  createRealtimeClientEventState,
  rememberRealtimeClientEvent,
} from './realtime-client-state';

describe('realtime acceptance client state', () => {
  test('deduplicates event IDs across reconnects', () => {
    const state = createRealtimeClientEventState();
    expect(rememberRealtimeClientEvent(state, 'event-0001')).toBe(true);
    expect(rememberRealtimeClientEvent(state, 'event-0001')).toBe(false);
  });

  test('retains only the bounded newest IDs', () => {
    const state = createRealtimeClientEventState();
    expect(rememberRealtimeClientEvent(state, 'event-0001', 2)).toBe(true);
    expect(rememberRealtimeClientEvent(state, 'event-0002', 2)).toBe(true);
    expect(rememberRealtimeClientEvent(state, 'event-0003', 2)).toBe(true);
    expect(rememberRealtimeClientEvent(state, 'event-0001', 2)).toBe(true);
    expect([...state.seenEventIds]).toEqual(['event-0003', 'event-0001']);
  });
});
