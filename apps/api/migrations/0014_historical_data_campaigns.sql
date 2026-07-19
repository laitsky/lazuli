-- Migration 0014: Generic, product-relevant historical market-data archives.
-- OHLCV keeps its existing purpose-built tables; these tables cover funding,
-- OI, institutional series, catalog snapshots, and event aggregates.

CREATE TABLE IF NOT EXISTS historical_data_campaigns (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('planned','running','paused','complete','complete_with_gaps','failed','cancelled')),
  requested_config_json TEXT NOT NULL,
  frozen_universe_json TEXT NOT NULL DEFAULT '{}',
  total_components INTEGER NOT NULL DEFAULT 0,
  completed_components INTEGER NOT NULL DEFAULT 0,
  gap_components INTEGER NOT NULL DEFAULT 0,
  total_tasks INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS historical_data_components (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  dataset TEXT NOT NULL,
  provider TEXT NOT NULL,
  resolution TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','running','complete','gap','failed','cancelled')),
  task_count INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  gap_tasks INTEGER NOT NULL DEFAULT 0,
  gap_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (campaign_id) REFERENCES historical_data_campaigns(id)
);

CREATE TABLE IF NOT EXISTS historical_data_tasks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  component_id TEXT NOT NULL,
  dataset TEXT NOT NULL,
  provider TEXT NOT NULL,
  exchange TEXT,
  entity TEXT NOT NULL,
  market_type TEXT,
  resolution TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','complete','gap','failed','cancelled')),
  coverage_state TEXT NOT NULL DEFAULT 'planned',
  failure_class TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER,
  next_attempt_at INTEGER,
  object_key TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (campaign_id) REFERENCES historical_data_campaigns(id),
  FOREIGN KEY (component_id) REFERENCES historical_data_components(id)
);

CREATE TABLE IF NOT EXISTS historical_data_manifests (
  object_key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  dataset TEXT NOT NULL,
  provider TEXT NOT NULL,
  exchange TEXT,
  entity TEXT NOT NULL,
  market_type TEXT,
  resolution TEXT NOT NULL,
  first_timestamp INTEGER,
  last_timestamp INTEGER,
  row_count INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  coverage_state TEXT NOT NULL,
  gap_summary_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  finalized_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (task_id) REFERENCES historical_data_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_history_campaign_status ON historical_data_campaigns(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_history_components_campaign ON historical_data_components(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_history_tasks_due ON historical_data_tasks(status, next_attempt_at, provider);
CREATE INDEX IF NOT EXISTS idx_history_tasks_campaign ON historical_data_tasks(campaign_id, component_id, status);
CREATE INDEX IF NOT EXISTS idx_history_manifest_lookup ON historical_data_manifests(dataset, exchange, entity, market_type, resolution, first_timestamp, last_timestamp);

CREATE TRIGGER IF NOT EXISTS update_history_campaign_updated_at AFTER UPDATE ON historical_data_campaigns
BEGIN UPDATE historical_data_campaigns SET updated_at=unixepoch() WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS update_history_component_updated_at AFTER UPDATE ON historical_data_components
BEGIN UPDATE historical_data_components SET updated_at=unixepoch() WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS update_history_task_updated_at AFTER UPDATE ON historical_data_tasks
BEGIN UPDATE historical_data_tasks SET updated_at=unixepoch() WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS update_history_manifest_updated_at AFTER UPDATE ON historical_data_manifests
BEGIN UPDATE historical_data_manifests SET updated_at=unixepoch() WHERE object_key=NEW.object_key; END;
