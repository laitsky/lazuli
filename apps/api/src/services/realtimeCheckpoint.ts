/** Project a bounded insertion-ordered checkpoint without mutating the caller. */
export function boundedCheckpointEvictions(
  current: Set<string>,
  additions: string[],
  capacity: number
): string[] {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error('Realtime checkpoint capacity must be positive');
  }
  const projected = new Set(current);
  for (const value of additions) {
    projected.delete(value);
    projected.add(value);
  }
  const evicted: string[] = [];
  while (projected.size > capacity) {
    const oldest = projected.values().next().value as string | undefined;
    if (!oldest) break;
    projected.delete(oldest);
    evicted.push(oldest);
  }
  return evicted;
}

/** Retain the newest serialized values within both count and byte bounds. */
export function boundedSerializedCheckpoint<T>(
  current: T[],
  additions: T[],
  capacity: number,
  maximumBytes: number,
  serialize: (value: T) => string = JSON.stringify
): { retained: T[]; evicted: T[] } {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error('Serialized checkpoint capacity must be positive');
  }
  if (!Number.isInteger(maximumBytes) || maximumBytes < 2) {
    throw new Error('Serialized checkpoint byte bound must include array framing');
  }
  const encoder = new TextEncoder();
  const projected = [...current, ...additions].map((value) => ({
    value,
    bytes: encoder.encode(serialize(value)).byteLength,
  }));
  let bytes = 2 + projected.reduce((sum, item) => sum + item.bytes, 0);
  if (projected.length > 1) bytes += projected.length - 1;
  const evicted: T[] = [];
  while (projected.length > capacity || bytes > maximumBytes) {
    const removed = projected.shift();
    if (!removed) break;
    bytes -= removed.bytes;
    if (projected.length > 0) bytes -= 1;
    evicted.push(removed.value);
  }
  return { retained: projected.map(({ value }) => value), evicted };
}
