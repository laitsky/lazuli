-- Migration 0002: Cloudflare-native control plane
-- D1 stores metadata and operational state only. Large OHLCV archives live in R2.

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details_json TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS exchange_catalog (
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('spot', 'perp')),
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  first_seen_at INTEGER DEFAULT (unixepoch()),
  last_seen_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (exchange, symbol, type)
);

CREATE TABLE IF NOT EXISTS backfill_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('creating', 'queued', 'running', 'complete', 'failed', 'cancelled')),
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  requested_universe_json TEXT NOT NULL,
  total_tasks INTEGER DEFAULT 0,
  pending_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS backfill_tasks (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'failed', 'cancelled')),
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('spot', 'perp')),
  timeframe TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  attempts INTEGER DEFAULT 0,
  object_key TEXT,
  row_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (job_id) REFERENCES backfill_jobs(id)
);

CREATE TABLE IF NOT EXISTS r2_ohlcv_manifests (
  object_key TEXT PRIMARY KEY,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('spot', 'perp')),
  timeframe TEXT NOT NULL,
  first_timestamp INTEGER,
  last_timestamp INTEGER,
  row_count INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'failed')),
  gap_summary_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_backfill_tasks_job_status
  ON backfill_tasks(job_id, status);

CREATE INDEX IF NOT EXISTS idx_backfill_tasks_range
  ON backfill_tasks(exchange, symbol, type, timeframe, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_r2_ohlcv_lookup
  ON r2_ohlcv_manifests(exchange, symbol, type, timeframe, first_timestamp, last_timestamp);

CREATE TRIGGER IF NOT EXISTS update_app_config_updated_at
  AFTER UPDATE ON app_config
  FOR EACH ROW
  BEGIN
    UPDATE app_config SET updated_at = unixepoch() WHERE key = NEW.key;
  END;

CREATE TRIGGER IF NOT EXISTS update_backfill_jobs_updated_at
  AFTER UPDATE ON backfill_jobs
  FOR EACH ROW
  BEGIN
    UPDATE backfill_jobs SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_backfill_tasks_updated_at
  AFTER UPDATE ON backfill_tasks
  FOR EACH ROW
  BEGIN
    UPDATE backfill_tasks SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_r2_ohlcv_manifests_updated_at
  AFTER UPDATE ON r2_ohlcv_manifests
  FOR EACH ROW
  BEGIN
    UPDATE r2_ohlcv_manifests SET updated_at = unixepoch() WHERE object_key = NEW.object_key;
  END;
