const MAX_CLIENT_LATENCY_MS = 300_000;

export interface RealtimeLatencySample {
  eventId: string;
  provider: string;
  sourceToClientMs: number;
  ingestToClientMs: number | null;
}

export function extractRealtimeLatencySample(
  envelope: { event?: unknown; data?: unknown },
  receivedAt = Date.now()
): RealtimeLatencySample | null {
  for (const candidate of [envelope.event, envelope.data]) {
    if (!isRecord(candidate) || candidate.type !== 'liquidation-print') continue;
    const exchangeTimestamp = candidate.exchangeTimestamp;
    const eventId = candidate.eventId;
    if (
      typeof exchangeTimestamp !== 'number' ||
      !Number.isFinite(exchangeTimestamp) ||
      typeof eventId !== 'string' ||
      eventId.length < 8
    ) {
      continue;
    }
    const sourceToClientMs = receivedAt - exchangeTimestamp;
    if (sourceToClientMs < 0 || sourceToClientMs > MAX_CLIENT_LATENCY_MS) return null;
    const ingestedAt = candidate.ingestedAt;
    const ingestToClientMs =
      typeof ingestedAt === 'number' &&
      Number.isFinite(ingestedAt) &&
      receivedAt >= ingestedAt &&
      receivedAt - ingestedAt <= MAX_CLIENT_LATENCY_MS
        ? receivedAt - ingestedAt
        : null;
    const provenance = isRecord(candidate.provenance) ? candidate.provenance : null;
    const provider =
      provenance && typeof provenance.provider === 'string'
        ? provenance.provider.toLowerCase().slice(0, 40)
        : 'unknown';
    return { eventId, provider, sourceToClientMs, ingestToClientMs };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
