-- Migration 0003: Growth, retention, and alerting foundation.
-- Adds user persistence, magic-link sessions, saved objects, API keys, and
-- alert event records while preserving the original price_alerts table.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS auth_magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_auth_magic_links_token
  ON auth_magic_links(token_hash, expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  last_seen_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token
  ON user_sessions(token_hash, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS saved_workspaces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  state_json TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_saved_workspaces_user
  ON saved_workspaces(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  items_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user
  ON watchlists(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS saved_backtests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  strategy_json TEXT NOT NULL,
  result_json TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_saved_backtests_user
  ON saved_backtests(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  last_used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user
  ON api_keys(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  alert_id INTEGER NOT NULL,
  user_id TEXT,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  trigger_price REAL NOT NULL,
  target_price REAL NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('above', 'below')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'published', 'failed')),
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_alert_events_alert
  ON alert_events(alert_id, created_at DESC);

CREATE TABLE IF NOT EXISTS alpha_feed_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  score REAL NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_alpha_feed_events_score
  ON alpha_feed_events(score DESC, created_at DESC);

ALTER TABLE price_alerts ADD COLUMN user_id TEXT;
ALTER TABLE price_alerts ADD COLUMN market_type TEXT DEFAULT 'spot' CHECK (market_type IN ('spot', 'perp'));
ALTER TABLE price_alerts ADD COLUMN topic TEXT;
ALTER TABLE price_alerts ADD COLUMN delivery_json TEXT;
ALTER TABLE price_alerts ADD COLUMN metadata_json TEXT;
ALTER TABLE price_alerts ADD COLUMN last_price REAL;
ALTER TABLE price_alerts ADD COLUMN last_evaluated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_active
  ON price_alerts(user_id, active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_alerts_active_market
  ON price_alerts(active, exchange, symbol, market_type);

CREATE TRIGGER IF NOT EXISTS update_users_updated_at
  AFTER UPDATE ON users
  FOR EACH ROW
  BEGIN
    UPDATE users SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_saved_workspaces_updated_at
  AFTER UPDATE ON saved_workspaces
  FOR EACH ROW
  BEGIN
    UPDATE saved_workspaces SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_watchlists_updated_at
  AFTER UPDATE ON watchlists
  FOR EACH ROW
  BEGIN
    UPDATE watchlists SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_saved_backtests_updated_at
  AFTER UPDATE ON saved_backtests
  FOR EACH ROW
  BEGIN
    UPDATE saved_backtests SET updated_at = unixepoch() WHERE id = NEW.id;
  END;
