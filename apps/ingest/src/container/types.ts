import type { RealtimeEvent, RealtimeTopic, SupportedExchange } from '@lazuli/shared';

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
  publishEnabled: boolean;
  topicAllowlist: ReadonlySet<RealtimeTopic> | null;
  controlApiToken: string | null;
}

export interface ProviderHealth {
  provider: ProviderName;
  state: 'connecting' | 'connected' | 'degraded' | 'disconnected' | 'stopped';
  connectedAt: number | null;
  lastMessageAt: number | null;
  lastEventAt: number | null;
  freshnessMs: number | null;
  reconnects: number;
  sequenceGaps: number;
  unresolvedGaps: number;
  pendingSnapshots: number;
  reconciliations: number;
  reconciliationFailures: number;
  lastReconciledAt: number | null;
  lastRecoveredAt: number | null;
  parseErrors: number;
  eventsEmitted: number;
  lastError: string | null;
  channels?: Record<string, ProviderChannelHealth>;
}

export interface ProviderChannelHealth {
  state: 'connecting' | 'connected' | 'degraded' | 'disconnected' | 'stopped';
  connectedAt: number | null;
  lastMessageAt: number | null;
  reconnects: number;
  lastError: string | null;
}

export interface BatchHealth {
  publishingEnabled: boolean;
  topicAllowlist: RealtimeTopic[] | null;
  filtered: number;
  queued: number;
  dropped: number;
  batchesSent: number;
  batchesFailed: number;
  lastSuccessAt: number | null;
  lastError: string | null;
}

export type EmitEvent = (event: RealtimeEvent) => void;

const ALLOWED_PROVIDERS: ProviderName[] = ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'];
const PUBLIC_TOPIC_PATTERN =
  /^(ticker|liquidations|liquidation-bands|trades|cvd|orderbook|funding|open-interest):(binance|bybit|okx|hyperliquid|upbit):[a-z0-9._-]+$/;

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
  const topicAllowlist = parseTopicAllowlist(env.INGEST_TOPIC_ALLOWLIST);

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
    // Coalesce each ordered topic lane below the 800 ms end-to-end budget.
    // A 200 ms cadence saturated the signed API/DO checkpoint path at live
    // ticker rates; 400 ms leaves measured staging dispatch headroom.
    batchIntervalMs: positiveInt(env.INGEST_BATCH_INTERVAL_MS, 400, 5_000),
    maxBufferedEvents: positiveInt(env.INGEST_MAX_BUFFERED_EVENTS, 10_000, 100_000),
    publishEnabled: env.REALTIME_PUBLISH_ENABLED !== 'false',
    topicAllowlist,
    controlApiToken: env.CONTROL_API_TOKEN ?? null,
  };
}

/**
 * Undefined means unrestricted ingestion. An explicitly empty value means no
 * topics, which makes a malformed or accidentally blank rollout fail closed.
 */
export function parseTopicAllowlist(value: string | undefined): ReadonlySet<RealtimeTopic> | null {
  if (value === undefined) return null;
  const topics = value
    .split(',')
    .map((topic) => topic.trim().toLowerCase())
    .filter((topic): topic is RealtimeTopic => PUBLIC_TOPIC_PATTERN.test(topic));
  return new Set(topics);
}
