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
