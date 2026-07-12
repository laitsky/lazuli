const MAX_CLIENT_LATENCY_MS = 300_000;

export interface RealtimeLatencySample {
  eventId: string;
  provider: string;
  latencyMs: number;
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
    const latencyMs = receivedAt - exchangeTimestamp;
    if (latencyMs < 0 || latencyMs > MAX_CLIENT_LATENCY_MS) return null;
    const provenance = isRecord(candidate.provenance) ? candidate.provenance : null;
    const provider =
      provenance && typeof provenance.provider === 'string'
        ? provenance.provider.toLowerCase().slice(0, 40)
        : 'unknown';
    return { eventId, provider, latencyMs };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
