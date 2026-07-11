-- Migration 0004: Persisted Signal Lab strategies.
-- Versioned strategy definitions keep scanner/backtest work from disappearing
-- between sessions and allow the UI to show each strategy's latest result.

CREATE TABLE IF NOT EXISTS signal_lab_strategies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_type TEXT NOT NULL DEFAULT 'spot' CHECK (market_type IN ('spot', 'perp')),
  timeframe TEXT NOT NULL,
  strategy_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  parent_id TEXT,
  latest_backtest_json TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (parent_id) REFERENCES signal_lab_strategies(id)
);

CREATE INDEX IF NOT EXISTS idx_signal_lab_strategies_user
  ON signal_lab_strategies(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_lab_strategies_parent
  ON signal_lab_strategies(parent_id, version DESC);

CREATE TRIGGER IF NOT EXISTS update_signal_lab_strategies_updated_at
  AFTER UPDATE ON signal_lab_strategies
  FOR EACH ROW
  BEGIN
    UPDATE signal_lab_strategies SET updated_at = unixepoch() WHERE id = NEW.id;
  END;
