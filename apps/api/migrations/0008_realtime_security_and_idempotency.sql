-- Migration 0008: close realtime replay, alert concurrency, and KPI uniqueness gaps.

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_events_one_trigger_per_alert
  ON alert_events(alert_id)
  WHERE created_at >= 1783728000;

CREATE TABLE IF NOT EXISTS realtime_ingest_batches (
  batch_hash TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  CHECK (expires_at > received_at)
);

CREATE INDEX IF NOT EXISTS idx_realtime_ingest_batches_expiry
  ON realtime_ingest_batches(expires_at);

CREATE TABLE IF NOT EXISTS product_metric_unique_subjects (
  metric_period TEXT NOT NULL,
  metric TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (metric_period, metric, subject_hash)
);

CREATE INDEX IF NOT EXISTS idx_product_metric_unique_subjects_created
  ON product_metric_unique_subjects(created_at);
