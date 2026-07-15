export interface RealtimeClientEventState {
  seenEventIds: Set<string>;
  eventIdOrder: string[];
}

export function createRealtimeClientEventState(): RealtimeClientEventState {
  return { seenEventIds: new Set(), eventIdOrder: [] };
}

export function rememberRealtimeClientEvent(
  state: RealtimeClientEventState,
  eventId: string,
  maximum = 2_048
): boolean {
  if (!Number.isInteger(maximum) || maximum < 1) {
    throw new Error('Realtime client event capacity must be positive');
  }
  if (state.seenEventIds.has(eventId)) return false;
  state.seenEventIds.add(eventId);
  state.eventIdOrder.push(eventId);
  while (state.eventIdOrder.length > maximum) {
    const oldest = state.eventIdOrder.shift();
    if (oldest) state.seenEventIds.delete(oldest);
  }
  return true;
}
