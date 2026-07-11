-- Migration 0011: audited, expiring staging-only fault injection controls.

CREATE TABLE IF NOT EXISTS staging_fault_injections (
  target TEXT PRIMARY KEY CHECK (target IN ('provider', 'd1', 'r2', 'queue', 'delivery')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  expires_at INTEGER,
  config_json TEXT NOT NULL DEFAULT '{}',
  change_id TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS staging_fault_injection_audit (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('enable', 'disable', 'expire')),
  change_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_staging_fault_injection_audit_created
  ON staging_fault_injection_audit(created_at DESC);
