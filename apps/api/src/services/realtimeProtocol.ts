export const REALTIME_V2_PROTOCOL = 'lazuli.realtime.v2';
export const MAX_REALTIME_BATCH_EVENTS = 500;
export const MAX_REALTIME_FRAME_BYTES = 512_000;

export interface CanonicalRealtimeEnvelope {
  type: 'event';
  topic: string;
  sequence: number;
  event: Record<string, unknown>;
  data: Record<string, unknown>;
  publishedAt: number;
}

export interface RealtimeBatchEnvelope {
  type: 'batch';
  schemaVersion: 1;
  topic: string;
  firstSequence: number;
  lastSequence: number;
  events: CanonicalRealtimeEnvelope[];
  publishedAt: number;
}

export function realtimeEventId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const eventId = (value as Record<string, unknown>).eventId;
  return typeof eventId === 'string' && /^[A-Za-z0-9._:-]{8,160}$/.test(eventId) ? eventId : null;
}

export function filterAcceptedRealtimeEvents<T extends Record<string, unknown>>(
  events: T[],
  acceptedEventIds: Iterable<string>
): T[] {
  const pending = new Set(acceptedEventIds);
  return events.filter((event) => {
    const eventId = realtimeEventId(event);
    return eventId !== null && pending.delete(eventId);
  });
}

export function acceptsRealtimeV2(header: string | null): boolean {
  return (header ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes(REALTIME_V2_PROTOCOL);
}

export function createBatchEnvelope(
  topic: string,
  events: CanonicalRealtimeEnvelope[]
): RealtimeBatchEnvelope {
  const first = events[0];
  const last = events.at(-1);
  if (!first || !last) throw new Error('Realtime batch requires at least one event');
  return {
    type: 'batch',
    schemaVersion: 1,
    topic,
    firstSequence: first.sequence,
    lastSequence: last.sequence,
    events,
    publishedAt: Date.now(),
  };
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
