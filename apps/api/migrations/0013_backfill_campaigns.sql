-- Migration 0013: reliable full-history backfill campaigns
-- D1 remains the control plane; canonical OHLCV payloads continue to live in R2.

CREATE TABLE IF NOT EXISTS backfill_campaigns (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN ('planned', 'running', 'paused', 'complete', 'complete_with_gaps', 'failed', 'cancelled')
  ),
  start_time INTEGER NOT NULL,
  cutoff_time INTEGER NOT NULL,
  requested_config_json TEXT NOT NULL,
  frozen_universe_json TEXT NOT NULL,
  total_components INTEGER NOT NULL DEFAULT 0,
  completed_components INTEGER NOT NULL DEFAULT 0,
  gap_components INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS backfill_campaign_components (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  exchange TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('spot', 'perp')),
  timeframe TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('planned', 'running', 'complete', 'gap', 'cancelled')
  ),
  job_id TEXT,
  gap_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (campaign_id) REFERENCES backfill_campaigns(id)
);

ALTER TABLE backfill_jobs ADD COLUMN campaign_id TEXT;
ALTER TABLE backfill_jobs ADD COLUMN campaign_component_id TEXT;

ALTER TABLE backfill_tasks ADD COLUMN failure_class TEXT;
ALTER TABLE backfill_tasks ADD COLUMN next_attempt_at INTEGER;
ALTER TABLE backfill_tasks ADD COLUMN first_attempt_at INTEGER;
ALTER TABLE backfill_tasks ADD COLUMN coverage_state TEXT NOT NULL DEFAULT 'planned';

ALTER TABLE r2_ohlcv_manifests ADD COLUMN coverage_state TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE r2_ohlcv_manifests ADD COLUMN finalized_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_backfill_campaigns_status
  ON backfill_campaigns(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_backfill_campaign_components_progress
  ON backfill_campaign_components(campaign_id, status, exchange);

CREATE INDEX IF NOT EXISTS idx_backfill_jobs_campaign
  ON backfill_jobs(campaign_id, campaign_component_id, status);

CREATE INDEX IF NOT EXISTS idx_backfill_tasks_retry
  ON backfill_tasks(status, next_attempt_at, exchange);

CREATE TRIGGER IF NOT EXISTS update_backfill_campaigns_updated_at
  AFTER UPDATE ON backfill_campaigns
  FOR EACH ROW
  BEGIN
    UPDATE backfill_campaigns SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_backfill_campaign_components_updated_at
  AFTER UPDATE ON backfill_campaign_components
  FOR EACH ROW
  BEGIN
    UPDATE backfill_campaign_components SET updated_at = unixepoch() WHERE id = NEW.id;
  END;
