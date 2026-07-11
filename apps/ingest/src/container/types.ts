import type { RealtimeEvent, SupportedExchange } from '@lazuli/shared';

export type ProviderName = SupportedExchange;

export interface IngestConfig {
  environment: string;
  apiBaseUrl: string;
  signingSecret: string;
  signingKeyId: string;
  providers: ProviderName[];
  symbols: string[];
  upbitQuote: string;
  port: number;
  batchSize: number;
  batchIntervalMs: number;
  maxBufferedEvents: number;
  controlApiToken: string | null;
}

export interface ProviderHealth {
  provider: ProviderName;
  state: 'connecting' | 'connected' | 'degraded' | 'disconnected' | 'stopped';
  connectedAt: number | null;
  lastMessageAt: number | null;
  lastEventAt: number | null;
  reconnects: number;
  sequenceGaps: number;
  parseErrors: number;
  eventsEmitted: number;
  lastError: string | null;
}

export interface BatchHealth {
  queued: number;
  dropped: number;
  batchesSent: number;
  batchesFailed: number;
  lastSuccessAt: number | null;
  lastError: string | null;
}

export type EmitEvent = (event: RealtimeEvent) => void;

const ALLOWED_PROVIDERS: ProviderName[] = ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'];

function positiveInt(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function loadConfig(env: Record<string, string | undefined>): IngestConfig {
  const providers = (env.INGEST_PROVIDERS ?? ALLOWED_PROVIDERS.join(','))
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is ProviderName => ALLOWED_PROVIDERS.includes(value as ProviderName))
    .filter((value, index, values) => values.indexOf(value) === index);
  const symbols = (env.INGEST_SYMBOLS ?? 'BTC/USDT,ETH/USDT')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(
      (value, index, values) =>
        /^[-A-Z0-9]+\/[A-Z0-9]+$/.test(value) && values.indexOf(value) === index
    )
    .slice(0, 50);
  const apiBaseUrl = env.API_BASE_URL?.replace(/\/$/, '');

  if (!apiBaseUrl) throw new Error('API_BASE_URL is required');
  if (!env.INGEST_SIGNING_SECRET) {
    throw new Error('INGEST_SIGNING_SECRET is required');
  }
  if (providers.length === 0) throw new Error('at least one supported provider is required');
  if (symbols.length === 0) throw new Error('at least one BASE/QUOTE symbol is required');

  return {
    environment: env.ENVIRONMENT ?? 'local',
    apiBaseUrl,
    signingSecret: env.INGEST_SIGNING_SECRET,
    signingKeyId: env.INGEST_SIGNING_SECRET_ID?.trim() || 'ingest-current',
    providers,
    symbols,
    upbitQuote: (env.UPBIT_QUOTE ?? 'KRW').toUpperCase(),
    port: positiveInt(env.PORT, 8080, 65_535),
    batchSize: positiveInt(env.INGEST_BATCH_SIZE, 500, 500),
    batchIntervalMs: positiveInt(env.INGEST_BATCH_INTERVAL_MS, 200, 5_000),
    maxBufferedEvents: positiveInt(env.INGEST_MAX_BUFFERED_EVENTS, 10_000, 100_000),
    controlApiToken: env.CONTROL_API_TOKEN ?? null,
  };
}
