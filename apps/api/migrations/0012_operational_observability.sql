-- Migration 0012: durable operational SLI rollups, incidents, synthetic probes,
-- paging history, and immutable release evidence references.

CREATE TABLE IF NOT EXISTS operational_sli_rollups (
  bucket_start INTEGER NOT NULL,
  bucket_seconds INTEGER NOT NULL DEFAULT 300 CHECK (bucket_seconds > 0),
  sli TEXT NOT NULL,
  dimension_key TEXT NOT NULL DEFAULT '',
  value REAL,
  good_count INTEGER NOT NULL DEFAULT 0 CHECK (good_count >= 0),
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  completeness REAL NOT NULL DEFAULT 1 CHECK (completeness >= 0 AND completeness <= 1),
  source TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (bucket_start, bucket_seconds, sli, dimension_key)
);

CREATE INDEX IF NOT EXISTS idx_operational_sli_lookup
  ON operational_sli_rollups(sli, bucket_start DESC, dimension_key);

CREATE TABLE IF NOT EXISTS operational_sli_samples (
  id TEXT PRIMARY KEY,
  sli TEXT NOT NULL,
  dimension_key TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  success INTEGER CHECK (success IN (0, 1)),
  source TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_operational_sli_samples_lookup
  ON operational_sli_samples(sli, observed_at DESC, dimension_key);

CREATE TABLE IF NOT EXISTS operational_incidents (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'acknowledged', 'resolved')),
  severity TEXT NOT NULL CHECK (severity IN ('page', 'ticket')),
  owner TEXT NOT NULL,
  runbook_url TEXT NOT NULL,
  summary TEXT NOT NULL,
  observed_value REAL,
  threshold_value REAL,
  details_json TEXT NOT NULL DEFAULT '{}',
  opened_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_observed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  acknowledged_at INTEGER,
  acknowledged_by TEXT,
  resolved_at INTEGER,
  resolution TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_incidents_active_dedupe
  ON operational_incidents(dedupe_key)
  WHERE state IN ('open', 'acknowledged');

CREATE INDEX IF NOT EXISTS idx_operational_incidents_state
  ON operational_incidents(state, severity, last_observed_at DESC);

CREATE TABLE IF NOT EXISTS operational_alert_deliveries (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  transition TEXT NOT NULL CHECK (transition IN ('opened', 'reminder', 'resolved')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'failed')),
  provider_status INTEGER,
  last_error TEXT,
  attempted_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (incident_id) REFERENCES operational_incidents(id)
);

CREATE INDEX IF NOT EXISTS idx_operational_alert_delivery_incident
  ON operational_alert_deliveries(incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS synthetic_probe_results (
  id TEXT PRIMARY KEY,
  probe TEXT NOT NULL,
  target TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'worker',
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  status_code INTEGER,
  latency_ms REAL,
  error_code TEXT,
  deployment_id TEXT,
  observed_at INTEGER NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_synthetic_probe_lookup
  ON synthetic_probe_results(probe, observed_at DESC, success);

CREATE TABLE IF NOT EXISTS release_evidence_references (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('staging', 'production')),
  strategy_item_id TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('implementation', 'test', 'production')),
  reference TEXT NOT NULL,
  sha256 TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(release_id, strategy_item_id, evidence_kind, reference)
);

CREATE INDEX IF NOT EXISTS idx_release_evidence_item
  ON release_evidence_references(release_id, strategy_item_id, evidence_kind);

CREATE TRIGGER IF NOT EXISTS operational_sli_rollups_updated_at
  AFTER UPDATE ON operational_sli_rollups
  FOR EACH ROW BEGIN
    UPDATE operational_sli_rollups SET updated_at = unixepoch()
    WHERE bucket_start = NEW.bucket_start AND bucket_seconds = NEW.bucket_seconds
      AND sli = NEW.sli AND dimension_key = NEW.dimension_key;
  END;

CREATE TRIGGER IF NOT EXISTS operational_incidents_updated_at
  AFTER UPDATE ON operational_incidents
  FOR EACH ROW BEGIN
    UPDATE operational_incidents SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS release_evidence_references_immutable_update
  BEFORE UPDATE ON release_evidence_references
  BEGIN SELECT RAISE(ABORT, 'release evidence references are immutable'); END;

CREATE TRIGGER IF NOT EXISTS release_evidence_references_immutable_delete
  BEFORE DELETE ON release_evidence_references
  BEGIN SELECT RAISE(ABORT, 'release evidence references are immutable'); END;
