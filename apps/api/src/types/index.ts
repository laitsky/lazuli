/**
 * Standard API response format for all endpoints
 * Ensures consistent response structure across the application
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  error: string | null;
  timestamp: number;
  meta?: ApiResponseMeta;
}

/**
 * Optional response metadata used for tracing, cache status, and throttling.
 */
export interface ApiResponseMeta {
  requestId?: string;
  cache?: {
    source?: string;
    ageMs?: number;
    stale?: boolean;
    refreshError?: string;
  };
  rateLimit?: {
    remaining?: number;
    retryAfterMs?: number;
    unavailable?: boolean;
  };
  [key: string]: unknown;
}

/**
 * Ticker data structure representing cryptocurrency market data
 * Used for both spot and perpetual futures markets
 */
export interface Ticker {
  symbol: string;
  exchange: string;
  type: 'spot' | 'perp';
  bid: number | null;
  ask: number | null;
  last: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  quoteVolume24h: number | null;
  change24h: number | null;
  percentage24h: number | null;
  timestamp: number;
  fundingRate?: number | null;
  openInterest?: number | null;
}

/**
 * Market information structure
 * Describes available trading pairs on exchanges
 */
export interface Market {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  type: 'spot' | 'perp';
  active: boolean;
  exchange: string;
}

/**
 * Exchange information and capabilities
 * Describes what markets each exchange supports
 */
export interface ExchangeInfo {
  name: string;
  id: string;
  supported: boolean;
  hasSpot: boolean;
  hasPerp: boolean;
  notes?: string;
}

/**
 * Supported exchange identifiers
 * Add new exchanges here when implementing additional integrations
 * - binance: Binance (spot + perpetual)
 * - bybit: Bybit (spot + perpetual)
 * - okx: OKX (spot + perpetual)
 * - hyperliquid: Hyperliquid DEX (perpetual only)
 * - upbit: Upbit Korea (spot only)
 */
export type SupportedExchange = 'binance' | 'bybit' | 'okx' | 'hyperliquid' | 'upbit';

/**
 * OHLCV candlestick data (Open, High, Low, Close, Volume)
 * Standard format for chart data across all timeframes
 */
export interface OHLCV {
  timestamp: number; // Candle start timestamp in milliseconds
  open: number; // Opening price
  high: number; // Highest price in the period
  low: number; // Lowest price in the period
  close: number; // Closing price
  volume: number; // Trading volume in base currency
}

/**
 * Supported timeframes for OHLCV data
 * Maps to standard exchange timeframe formats
 */
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '3d' | '1w';

/**
 * OHLCV response from /ohlcv/:exchange/:symbol
 */
export interface OHLCVResponse {
  exchange: string; // Exchange identifier
  symbol: string; // Trading pair symbol
  timeframe: Timeframe; // Requested timeframe
  candles: OHLCV[]; // Array of candlestick data
  count: number; // Number of candles returned
}

/**
 * Asset weight configuration for custom index
 * Each asset has a symbol and its weight in the index (as percentage)
 */
export interface IndexAsset {
  symbol: string; // Asset symbol (e.g., BTC-USDT)
  weight: number; // Weight percentage (0-100)
}

/**
 * Custom index performance data point
 * Shows the index value at a specific timestamp
 */
export interface IndexPerformancePoint {
  timestamp: number; // Timestamp in milliseconds
  value: number; // Normalized index value (starts at 100)
  change: number; // Percentage change from start
}

/**
 * Comparison benchmark data
 * Performance data for USDT/BTC/ETH/SOL benchmarks
 */
export interface BenchmarkPerformance {
  symbol: string; // Benchmark symbol
  name: string; // Display name
  data: IndexPerformancePoint[]; // Performance data points
}

/**
 * Custom index response with performance data
 */
export interface CustomIndexResponse {
  name: string; // Index name
  exchange: string; // Exchange used
  timeframe: Timeframe; // Timeframe used
  assets: IndexAsset[]; // Assets in the index
  performance: IndexPerformancePoint[]; // Index performance data
  benchmarks: BenchmarkPerformance[]; // Comparison benchmarks
  startTime: number; // Start timestamp
  endTime: number; // End timestamp
  totalReturn: number; // Total percentage return
}

/**
 * Cloudflare Workers environment bindings for the Lazuli API Worker.
 * These are declared in wrangler.jsonc and generated into worker-configuration.d.ts
 * by `wrangler types`. The interface here is kept in sync manually as a fallback.
 */
export interface Env {
  DB: D1Database;
  OHLCV_ARCHIVE: R2Bucket;
  BACKFILL_QUEUE: Queue<WorkerQueueMessage>;
  ALERT_DELIVERY_QUEUE?: Queue<AlertDeliveryQueueMessage>;
  BACKFILL_WORKFLOW?: Workflow<BackfillWorkflowParams>;
  API_ANALYTICS?: AnalyticsEngineDataset;
  MARKET_DATA_CACHE: DurableObjectNamespace;
  REALTIME_HUB: DurableObjectNamespace;
  PUBLIC_RATE_LIMITER: RateLimit;
  EXPENSIVE_RATE_LIMITER: RateLimit;
  BUILDER_PUBLIC_RATE_LIMITER: RateLimit;
  BUILDER_EXPENSIVE_RATE_LIMITER: RateLimit;
  EXCHANGE_RATE_LIMITER: RateLimit;
  ADMIN_RATE_LIMITER: RateLimit;
  ADMIN_API_KEY?: string;
  ADMIN_API_KEY_ID?: string;
  ADMIN_API_KEY_NEXT?: string;
  ADMIN_API_KEY_ID_NEXT?: string;
  ADMIN_SIGNING_SECRET?: string;
  ADMIN_SIGNING_SECRET_NEXT?: string;
  INGEST_SIGNING_SECRET?: string;
  INGEST_SIGNING_SECRET_ID?: string;
  INGEST_SIGNING_SECRET_NEXT?: string;
  INGEST_SIGNING_SECRET_NEXT_ID?: string;
  METRICS_INGEST_SECRET?: string;
  METRICS_INGEST_SECRET_ID?: string;
  METRICS_INGEST_SECRET_NEXT?: string;
  METRICS_INGEST_SECRET_NEXT_ID?: string;
  REALTIME_TOKEN_SECRET?: string;
  REALTIME_TOKEN_SECRET_ID?: string;
  REALTIME_TOKEN_SECRET_NEXT?: string;
  REALTIME_TOKEN_SECRET_NEXT_ID?: string;
  NOTIFICATION_ENCRYPTION_KEY?: string;
  NOTIFICATION_ENCRYPTION_KEY_ID?: string;
  NOTIFICATION_ENCRYPTION_KEY_NEXT?: string;
  NOTIFICATION_ENCRYPTION_KEY_NEXT_ID?: string;
  MAGIC_LINK_EMAIL?: SendEmail;
  ALERT_EMAIL?: SendEmail;
  MAGIC_LINK_EMAIL_FROM?: string;
  ALERT_EMAIL_FROM?: string;
  APP_BASE_URL?: string;
  CORS_ORIGIN?: string;
  ENVIRONMENT?: 'local' | 'staging' | 'production';
  REALTIME_INGEST_ENABLED?: string;
  ACCOUNT_FEATURES_ENABLED?: string;
  ALERT_EVALUATION_ENABLED?: string;
  ADMIN_ROUTES_ENABLED?: string;
  MAGIC_LINK_DELIVERY_WEBHOOK_SECRET?: string;
  MAGIC_LINK_DELIVERY_WEBHOOK_URL?: string;
  ALERT_DISCORD_WEBHOOK_URL?: string;
  ALERT_DELIVERY_WEBHOOK_SECRET?: string;
  ALERT_DELIVERY_WEBHOOK_URL?: string;
  ALERT_EMAIL_DELIVERY_WEBHOOK_SECRET?: string;
  ALERT_EMAIL_DELIVERY_WEBHOOK_URL?: string;
  ALERT_TELEGRAM_BOT_TOKEN?: string;
  ALERT_USER_WEBHOOKS_ENABLED?: string;
  ALERT_WEBHOOK_SIGNING_SECRET?: string;
  ALERT_WEBHOOK_SIGNING_SECRET_ID?: string;
  ALERT_WEBHOOK_SIGNING_SECRET_NEXT?: string;
  ALERT_WEBHOOK_SIGNING_SECRET_NEXT_ID?: string;
  OPERATIONAL_OWNER?: string;
  OPERATIONAL_ALERT_EMAIL?: string;
  OPS_READ_SECRET?: string;
  OPS_READ_SECRET_NEXT?: string;
  INGEST_HEALTH_URL?: string;
  PUBLIC_API_BASE_URL?: string;
}

/**
 * Queue payload for one idempotent OHLCV archive chunk. Chunks are intentionally
 * small enough to retry safely and to fit Worker memory when transformed to
 * NDJSON before writing to R2.
 */
export interface BackfillQueueMessage {
  jobId: string;
  taskId: string;
  exchange: SupportedExchange;
  symbol: string;
  type: 'spot' | 'perp';
  timeframe: Timeframe;
  startTime: number;
  endTime: number;
  attempt?: number;
}

/** One bounded, sequential archive partition for an asynchronous backtest. */
export interface AsyncBacktestQueueMessage {
  kind: 'async-backtest';
  jobId: string;
  chunkIndex: number;
}

/** One idempotent notification delivery attempt owned by the alert queue. */
export interface AlertDeliveryQueueMessage {
  kind: 'alert-delivery';
  attemptId: string;
}

/** Shared Queue payload union; legacy backfill payloads intentionally remain unchanged. */
export type WorkerQueueMessage =
  | BackfillQueueMessage
  | AsyncBacktestQueueMessage
  | AlertDeliveryQueueMessage;

/**
 * Parameters passed to the durable Cloudflare Workflow that fans a backfill job
 * into queue messages. The job rows in D1 remain the source of truth.
 */
export interface BackfillWorkflowParams {
  jobId: string;
}
