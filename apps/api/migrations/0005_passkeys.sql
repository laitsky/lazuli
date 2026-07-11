-- Migration 0005: Passkey/WebAuthn credentials.
-- Challenges are short-lived and credentials are scoped to existing users.

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
  metadata_json TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_lookup
  ON webauthn_challenges(id, type, expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT,
  device_type TEXT,
  backed_up INTEGER DEFAULT 0,
  name TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user
  ON passkeys(user_id, created_at DESC);
