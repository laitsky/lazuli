import type {
  RealtimeEvent,
  RealtimeMarketType,
  RealtimeProvenance,
  RealtimePublicChannel,
  RealtimeTopic,
  SupportedExchange,
} from '@lazuli/shared';

export function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function requiredNumber(value: unknown, field: string): number {
  const parsed = numberOrNull(value);
  if (parsed === null) throw new Error(`invalid ${field}`);
  return parsed;
}

export function canonicalSymbol(value: string): string {
  return value.toUpperCase().replace(/[-_/]/g, '');
}

export function marketTopic<
  TChannel extends RealtimePublicChannel,
  TExchange extends SupportedExchange,
>(
  channel: TChannel,
  exchange: TExchange,
  symbol: string,
  marketType: RealtimeMarketType
): `${TChannel}:${TExchange}:${string}` {
  const upper = symbol.trim().toUpperCase();
  const withoutSettlement = upper.split(':')[0] ?? upper;
  const compact = withoutSettlement.replace(/\.P$/, '').replace(/[-_/]/g, '');
  let identity = marketType === 'perp' ? `${compact}.P` : compact;
  if (marketType === 'spot') {
    const separated = withoutSettlement.replace(/\.P$/, '').match(/^([A-Z0-9]+)[-_/]([A-Z0-9]+)$/);
    if (separated?.[1] && separated[2]) {
      identity = `${separated[1]}-${separated[2]}`;
    } else {
      for (const quote of ['USDT', 'USDC', 'USD', 'KRW', 'BTC', 'ETH', 'EUR']) {
        if (compact.length > quote.length && compact.endsWith(quote)) {
          identity = `${compact.slice(0, -quote.length)}-${quote}`;
          break;
        }
      }
    }
  }
  return `${channel}:${exchange}:${identity.toLowerCase()}`;
}

export function createEvent<T extends RealtimeEvent>(input: {
  type: T['type'];
  topic: T['topic'];
  sequence: number;
  exchangeTimestamp: number;
  provider: string;
  upstreamSequence?: string | number;
  payload: T['payload'];
  quality?: RealtimeProvenance['quality'];
  kind?: RealtimeProvenance['kind'];
}): T {
  const now = Date.now();
  return {
    schemaVersion: 1,
    type: input.type,
    eventId: crypto.randomUUID(),
    sequence: input.sequence,
    topic: input.topic as RealtimeTopic,
    exchangeTimestamp: input.exchangeTimestamp,
    ingestedAt: now,
    publishedAt: now,
    provenance: {
      kind: input.kind ?? 'exchange-native',
      provider: input.provider,
      quality: input.quality ?? 'live',
      ...(input.upstreamSequence === undefined ? {} : { upstreamSequence: input.upstreamSequence }),
    },
    payload: input.payload,
  } as T;
}

export function rows(value: unknown): unknown[][] {
  return Array.isArray(value) ? value.filter((row): row is unknown[] => Array.isArray(row)) : [];
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
