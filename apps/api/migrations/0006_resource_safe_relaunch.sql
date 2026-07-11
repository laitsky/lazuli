-- Migration 0006: Resource-safe relaunch controls and hot-path indexes.

CREATE TABLE IF NOT EXISTS admin_nonces (
  key_id TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (key_id, nonce_hash)
);

CREATE INDEX IF NOT EXISTS idx_admin_nonces_expiry
  ON admin_nonces(expires_at);

CREATE TABLE IF NOT EXISTS institutional_provider_status (
  provider TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  ok INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_due
  ON price_alerts(COALESCE(last_evaluated_at, 0), updated_at)
  WHERE active = 1 AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix_active
  ON api_keys(key_prefix)
  WHERE revoked_at IS NULL;
