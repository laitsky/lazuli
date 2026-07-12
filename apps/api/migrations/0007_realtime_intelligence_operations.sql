-- Migration 0007: Realtime ingestion, derived intelligence, notification
-- delivery, asynchronous backtests, macro history, and product metrics.
--
-- D1 remains the control plane: high-frequency event bodies belong in bounded
-- Durable Object memory or R2, while this migration stores restart checkpoints,
-- rollups, job state, and operational evidence.

CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  exchange TEXT NOT NULL,
  stream TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT '',
  market_type TEXT NOT NULL DEFAULT '' CHECK (market_type IN ('', 'spot', 'perp')),
  last_sequence TEXT,
  last_exchange_timestamp INTEGER,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'reconciling', 'stale', 'failed')),
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(provider, exchange, stream, symbol, market_type)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_checkpoints_stream
  ON ingestion_checkpoints(exchange, stream, symbol, market_type);

CREATE INDEX IF NOT EXISTS idx_ingestion_checkpoints_health
  ON ingestion_checkpoints(status, updated_at);

CREATE TABLE IF NOT EXISTS derived_metric_rollups (
  id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_type TEXT NOT NULL CHECK (market_type IN ('spot', 'perp')),
  bucket_start INTEGER NOT NULL,
  bucket_seconds INTEGER NOT NULL CHECK (bucket_seconds > 0),
  value_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  source_fresh_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(metric, exchange, symbol, market_type, bucket_seconds, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_derived_metric_rollups_lookup
  ON derived_metric_rollups(
    metric,
    exchange,
    symbol,
    market_type,
    bucket_seconds,
    bucket_start DESC
  );

CREATE INDEX IF NOT EXISTS idx_derived_metric_rollups_freshness
  ON derived_metric_rollups(metric, source_fresh_at DESC);

CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'discord', 'telegram', 'webhook')),
  label TEXT NOT NULL,
  endpoint_ciphertext TEXT NOT NULL,
  secret_ciphertext TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  verified_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_notification_channels_user
  ON notification_channels(user_id, enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
  id TEXT PRIMARY KEY,
  alert_event_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'retry', 'delivered', 'failed', 'dead_letter')),
  attempt_number INTEGER NOT NULL DEFAULT 0 CHECK (attempt_number >= 0),
  provider TEXT,
  response_status INTEGER,
  last_error TEXT,
  queued_at INTEGER NOT NULL DEFAULT (unixepoch()),
  attempted_at INTEGER,
  delivered_at INTEGER,
  next_attempt_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (alert_event_id) REFERENCES alert_events(id),
  FOREIGN KEY (channel_id) REFERENCES notification_channels(id)
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_attempts_due
  ON notification_delivery_attempts(status, next_attempt_at, queued_at)
  WHERE status IN ('queued', 'retry');

CREATE INDEX IF NOT EXISTS idx_notification_delivery_attempts_event
  ON notification_delivery_attempts(alert_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_attempts_channel
  ON notification_delivery_attempts(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS async_backtest_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  strategy_id TEXT,
  saved_backtest_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'complete', 'failed', 'cancelled')),
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_type TEXT NOT NULL CHECK (market_type IN ('spot', 'perp')),
  timeframe TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  request_json TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  processed_rows INTEGER NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  total_rows INTEGER,
  result_object_key TEXT,
  result_summary_json TEXT,
  last_error TEXT,
  cancel_requested_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (strategy_id) REFERENCES signal_lab_strategies(id),
  FOREIGN KEY (saved_backtest_id) REFERENCES saved_backtests(id),
  CHECK (end_time > start_time),
  CHECK (total_rows IS NULL OR total_rows >= 0)
);

CREATE INDEX IF NOT EXISTS idx_async_backtest_jobs_queue
  ON async_backtest_jobs(status, created_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_async_backtest_jobs_user
  ON async_backtest_jobs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_async_backtest_jobs_strategy
  ON async_backtest_jobs(strategy_id, created_at DESC)
  WHERE strategy_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS macro_snapshots (
  id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,
  provider TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  value REAL,
  payload_json TEXT NOT NULL,
  source_status TEXT NOT NULL DEFAULT 'live'
    CHECK (source_status IN ('live', 'snapshot', 'fallback', 'stale', 'failed')),
  source_fresh_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(metric, provider, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_macro_snapshots_history
  ON macro_snapshots(metric, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_macro_snapshots_provider
  ON macro_snapshots(provider, source_status, observed_at DESC);

CREATE TABLE IF NOT EXISTS daily_product_metrics (
  metric_date TEXT NOT NULL,
  metric TEXT NOT NULL,
  dimensions_key TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  completeness REAL NOT NULL DEFAULT 1
    CHECK (completeness >= 0 AND completeness <= 1),
  sample_count INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  calculated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (metric_date, metric, dimensions_key),
  CHECK (length(metric_date) = 10)
);

CREATE INDEX IF NOT EXISTS idx_daily_product_metrics_metric
  ON daily_product_metrics(metric, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_product_metrics_date
  ON daily_product_metrics(metric_date DESC, completeness);

CREATE TRIGGER IF NOT EXISTS update_ingestion_checkpoints_updated_at
  AFTER UPDATE ON ingestion_checkpoints
  FOR EACH ROW
  BEGIN
    UPDATE ingestion_checkpoints SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_derived_metric_rollups_updated_at
  AFTER UPDATE ON derived_metric_rollups
  FOR EACH ROW
  BEGIN
    UPDATE derived_metric_rollups SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_notification_channels_updated_at
  AFTER UPDATE ON notification_channels
  FOR EACH ROW
  BEGIN
    UPDATE notification_channels SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_notification_delivery_attempts_updated_at
  AFTER UPDATE ON notification_delivery_attempts
  FOR EACH ROW
  BEGIN
    UPDATE notification_delivery_attempts SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_async_backtest_jobs_updated_at
  AFTER UPDATE ON async_backtest_jobs
  FOR EACH ROW
  BEGIN
    UPDATE async_backtest_jobs SET updated_at = unixepoch() WHERE id = NEW.id;
  END;
