-- Migration 0015: bounded, observable daily historical refresh execution.

CREATE TABLE IF NOT EXISTS historical_daily_refresh_runs (
  refresh_date TEXT PRIMARY KEY,
  campaign_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'planning','running','complete','complete_with_gaps','blocked_budget','failed'
  )),
  task_budget INTEGER NOT NULL CHECK (task_budget > 0),
  attempt_budget INTEGER NOT NULL CHECK (attempt_budget > 0),
  tasks_planned INTEGER NOT NULL DEFAULT 0 CHECK (tasks_planned >= 0),
  attempts_used INTEGER NOT NULL DEFAULT 0 CHECK (attempts_used >= 0),
  excluded_providers_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(excluded_providers_json)),
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','passed','failed')),
  verification_summary_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(verification_summary_json)),
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (campaign_id) REFERENCES historical_data_campaigns(id)
);

CREATE TABLE IF NOT EXISTS historical_provider_cooldowns (
  provider TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  failure_class TEXT,
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_history_refresh_status
  ON historical_daily_refresh_runs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_history_provider_cooldown
  ON historical_provider_cooldowns(cooldown_until, provider);

CREATE TRIGGER IF NOT EXISTS update_history_refresh_updated_at
AFTER UPDATE ON historical_daily_refresh_runs
BEGIN
  UPDATE historical_daily_refresh_runs SET updated_at=unixepoch()
  WHERE refresh_date=NEW.refresh_date;
END;

CREATE TRIGGER IF NOT EXISTS update_history_provider_cooldown_updated_at
AFTER UPDATE ON historical_provider_cooldowns
BEGIN
  UPDATE historical_provider_cooldowns SET updated_at=unixepoch()
  WHERE provider=NEW.provider;
END;
