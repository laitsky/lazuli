-- Migration 0010: audited, D1-backed production rollout controls.
--
-- The current row is the fast evaluation path. Every mutation also appends an
-- immutable audit event in the same D1 batch. Audit rows cannot be altered or
-- deleted, including by an accidentally broad administrative statement.

CREATE TABLE IF NOT EXISTS release_controls (
  flag TEXT PRIMARY KEY
    CHECK (flag IN (
      'realtime',
      'accounts',
      'alerts',
      'delivery_channels',
      'cron_reconciliation',
      'async_backtests',
      'admin_operations'
    )),
  state TEXT NOT NULL DEFAULT 'off'
    CHECK (state IN ('off', 'internal', '5', '25', '100')),
  subject_allowlist_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(subject_allowlist_json)),
  provider_allowlist_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(provider_allowlist_json)),
  topic_allowlist_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(topic_allowlist_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by TEXT NOT NULL,
  update_reason TEXT NOT NULL,
  last_request_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS release_control_audit (
  id TEXT PRIMARY KEY,
  flag TEXT NOT NULL,
  previous_state TEXT,
  next_state TEXT NOT NULL CHECK (next_state IN ('off', 'internal', '5', '25', '100')),
  previous_revision INTEGER,
  next_revision INTEGER NOT NULL CHECK (next_revision > 0),
  previous_config_json TEXT CHECK (previous_config_json IS NULL OR json_valid(previous_config_json)),
  next_config_json TEXT NOT NULL CHECK (json_valid(next_config_json)),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  request_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (flag) REFERENCES release_controls(flag)
);

CREATE INDEX IF NOT EXISTS idx_release_control_audit_flag
  ON release_control_audit(flag, created_at DESC, next_revision DESC);

CREATE TRIGGER IF NOT EXISTS release_control_audit_after_insert
  AFTER INSERT ON release_controls
  BEGIN
    INSERT INTO release_control_audit (
      id, flag, previous_state, next_state, previous_revision, next_revision,
      previous_config_json, next_config_json, actor, reason, request_id, created_at
    ) VALUES (
      lower(hex(randomblob(16))), NEW.flag, NULL, NEW.state, NULL, NEW.revision,
      NULL,
      json_object(
        'state', NEW.state,
        'subjectAllowlist', json(NEW.subject_allowlist_json),
        'providerAllowlist', json(NEW.provider_allowlist_json),
        'topicAllowlist', json(NEW.topic_allowlist_json)
      ),
      NEW.updated_by, NEW.update_reason, NEW.last_request_id, unixepoch()
    );
  END;

CREATE TRIGGER IF NOT EXISTS release_control_audit_after_update
  AFTER UPDATE ON release_controls
  BEGIN
    INSERT INTO release_control_audit (
      id, flag, previous_state, next_state, previous_revision, next_revision,
      previous_config_json, next_config_json, actor, reason, request_id, created_at
    ) VALUES (
      lower(hex(randomblob(16))), NEW.flag, OLD.state, NEW.state, OLD.revision, NEW.revision,
      json_object(
        'state', OLD.state,
        'subjectAllowlist', json(OLD.subject_allowlist_json),
        'providerAllowlist', json(OLD.provider_allowlist_json),
        'topicAllowlist', json(OLD.topic_allowlist_json)
      ),
      json_object(
        'state', NEW.state,
        'subjectAllowlist', json(NEW.subject_allowlist_json),
        'providerAllowlist', json(NEW.provider_allowlist_json),
        'topicAllowlist', json(NEW.topic_allowlist_json)
      ),
      NEW.updated_by, NEW.update_reason, NEW.last_request_id, unixepoch()
    );
  END;

CREATE TRIGGER IF NOT EXISTS release_control_audit_no_update
  BEFORE UPDATE ON release_control_audit
  BEGIN
    SELECT RAISE(ABORT, 'release control audit rows are immutable');
  END;

CREATE TRIGGER IF NOT EXISTS release_control_audit_no_delete
  BEFORE DELETE ON release_control_audit
  BEGIN
    SELECT RAISE(ABORT, 'release control audit rows are immutable');
  END;

-- Deploy dark. These rows are the source of truth immediately after the
-- additive migration and each insert is captured by the audit trigger above.
INSERT OR IGNORE INTO release_controls
  (flag, state, updated_by, update_reason)
VALUES
  ('realtime', 'off', 'migration-0010', 'initial dark deployment'),
  ('accounts', 'off', 'migration-0010', 'initial dark deployment'),
  ('alerts', 'off', 'migration-0010', 'initial dark deployment'),
  ('delivery_channels', 'off', 'migration-0010', 'initial dark deployment'),
  ('cron_reconciliation', 'off', 'migration-0010', 'initial dark deployment'),
  ('async_backtests', 'off', 'migration-0010', 'initial dark deployment'),
  ('admin_operations', 'off', 'migration-0010', 'initial dark deployment');
