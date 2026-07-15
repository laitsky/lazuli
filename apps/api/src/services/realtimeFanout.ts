export const PUBLIC_REALTIME_FANOUT_SHARDS = 4;

export function realtimeSequencerName(topic: string): string {
  return `${topic}:sequencer:v1`;
}

export function realtimeFanoutNames(topic: string): string[] {
  if (topic.startsWith('alerts:user:')) return [`${topic}:fanout:v3:0`];
  return Array.from(
    { length: PUBLIC_REALTIME_FANOUT_SHARDS },
    (_, index) => `${topic}:fanout:v3:${index}`
  );
}

export function realtimeFanoutNameForConnection(topic: string, connectionSeed: string): string {
  const names = realtimeFanoutNames(topic);
  if (names.length === 1) return names[0] ?? topic;
  return names[fnv1a(connectionSeed) % names.length] ?? names[0] ?? topic;
}

export function realtimeHubNames(topic: string): string[] {
  if (topic.startsWith('alerts:user:')) return [topic];
  return Array.from(
    { length: PUBLIC_REALTIME_FANOUT_SHARDS },
    (_, index) => `${topic}:fanout:${index}`
  );
}

export function realtimeHubNameForConnection(topic: string, connectionSeed: string): string {
  const names = realtimeHubNames(topic);
  if (names.length === 1) return names[0] ?? topic;
  return names[fnv1a(connectionSeed) % names.length] ?? names[0] ?? topic;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
