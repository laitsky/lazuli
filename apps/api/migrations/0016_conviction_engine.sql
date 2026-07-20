-- Migration 0016: Explainable Conviction Engine control-plane state.
--
-- D1 stores compact immutable events, recipe definitions, outcome labels, and
-- replay manifests. Dense replay/calibration objects remain in R2.

CREATE TABLE IF NOT EXISTS opportunity_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN (
    'momentum','mean-reversion','breakout','price-arbitrage','funding-arbitrage','institutional'
  )),
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_type TEXT NOT NULL CHECK (market_type IN ('spot','perp')),
  direction TEXT NOT NULL CHECK (direction IN ('long','short','neutral')),
  horizon TEXT NOT NULL CHECK (horizon IN ('1h','6h','24h')),
  regime TEXT NOT NULL DEFAULT 'unclassified',
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  opportunity_json TEXT NOT NULL CHECK (json_valid(opportunity_json)),
  replay_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_opportunity_events_rank
  ON opportunity_events(expires_at, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_events_market
  ON opportunity_events(exchange, symbol, market_type, horizon, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_events_kind
  ON opportunity_events(kind, horizon, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_outcomes (
  opportunity_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_type TEXT NOT NULL CHECK (market_type IN ('spot','perp')),
  direction TEXT NOT NULL CHECK (direction IN ('long','short','neutral')),
  horizon TEXT NOT NULL CHECK (horizon IN ('1h','6h','24h')),
  regime TEXT NOT NULL DEFAULT 'unclassified',
  entry_price REAL,
  exit_price REAL,
  gross_return_percent REAL,
  net_return_percent REAL,
  max_favorable_excursion_percent REAL,
  max_adverse_excursion_percent REAL,
  fee_bps REAL NOT NULL DEFAULT 0,
  funding_bps REAL NOT NULL DEFAULT 0,
  slippage_bps REAL NOT NULL DEFAULT 0,
  won INTEGER CHECK (won IN (0,1)),
  coverage_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (coverage_state IN ('pending','complete','partial','failed')),
  failure_reason TEXT,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (opportunity_id) REFERENCES opportunity_events(id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_outcomes_calibration
  ON opportunity_outcomes(kind, exchange, market_type, horizon, regime, coverage_state, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_outcomes_pending
  ON opportunity_outcomes(coverage_state, created_at)
  WHERE coverage_state = 'pending';

CREATE TABLE IF NOT EXISTS signal_recipes (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  universe_json TEXT NOT NULL CHECK (json_valid(universe_json)),
  horizon TEXT NOT NULL CHECK (horizon IN ('1h','6h','24h')),
  conditions_json TEXT NOT NULL CHECK (json_valid(conditions_json)),
  min_score REAL NOT NULL DEFAULT 60 CHECK (min_score >= 0 AND min_score <= 100),
  cooldown_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (cooldown_seconds >= 60),
  delivery_channel_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(delivery_channel_ids_json)),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  preview_json TEXT NOT NULL CHECK (json_valid(preview_json)),
  idempotency_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(root_id, version),
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_signal_recipes_user
  ON signal_recipes(user_id, root_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_signal_recipes_active
  ON signal_recipes(active, updated_at DESC)
  WHERE active = 1;

CREATE TABLE IF NOT EXISTS signal_recipe_matches (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  recipe_root_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  alert_event_id TEXT,
  matched_conditions_json TEXT NOT NULL CHECK (json_valid(matched_conditions_json)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (recipe_id) REFERENCES signal_recipes(id),
  FOREIGN KEY (opportunity_id) REFERENCES opportunity_events(id),
  UNIQUE(recipe_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_recipe_matches_user
  ON signal_recipe_matches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_recipe_matches_cooldown
  ON signal_recipe_matches(recipe_root_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_replays (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL UNIQUE,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_type TEXT NOT NULL CHECK (market_type IN ('spot','perp')),
  window TEXT NOT NULL CHECK (window IN ('1h','6h','24h')),
  replay_json TEXT NOT NULL CHECK (json_valid(replay_json)),
  object_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER,
  FOREIGN KEY (opportunity_id) REFERENCES opportunity_events(id)
);

CREATE INDEX IF NOT EXISTS idx_market_replays_public
  ON market_replays(expires_at, created_at DESC);

CREATE TRIGGER IF NOT EXISTS prevent_opportunity_events_update
BEFORE UPDATE ON opportunity_events
BEGIN
  SELECT RAISE(ABORT, 'opportunity events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS update_opportunity_outcomes_updated_at
AFTER UPDATE ON opportunity_outcomes
BEGIN
  UPDATE opportunity_outcomes SET updated_at = unixepoch()
  WHERE opportunity_id = NEW.opportunity_id;
END;

CREATE TRIGGER IF NOT EXISTS update_signal_recipes_updated_at
AFTER UPDATE ON signal_recipes
BEGIN
  UPDATE signal_recipes SET updated_at = unixepoch() WHERE id = NEW.id;
END;
