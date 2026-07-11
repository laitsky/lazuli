import { describe, expect, test } from 'bun:test';
import { BoundedEventIds } from './event-dedupe';

describe('browser realtime event deduplication', () => {
  test('drops repeated event IDs while keeping bounded recovery state', () => {
    const ids = new BoundedEventIds(2);
    expect(ids.remember('evt_1')).toBe(true);
    expect(ids.remember('evt_1')).toBe(false);
    expect(ids.remember('evt_2')).toBe(true);
    expect(ids.remember('evt_3')).toBe(true);
    expect(ids.remember('evt_1')).toBe(true);
  });
});
