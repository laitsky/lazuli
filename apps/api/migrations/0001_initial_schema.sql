-- Migration 0001: Initial SQLite schema for D1
-- Converted from database-setup.sql (PostgreSQL/Supabase)
--
-- D1 (SQLite) differences from PostgreSQL:
--   BIGSERIAL        -> INTEGER PRIMARY KEY AUTOINCREMENT
--   TIMESTAMP TZ     -> INTEGER (unixepoch seconds)
--   BOOLEAN          -> INTEGER (0/1)
--   DECIMAL(p,s)     -> REAL
--   RLS / policies   -> removed (handled at application level)
--   triggers         -> SQLite AFTER UPDATE ... BEGIN ... END syntax

-- 1. tickers: Historical ticker data
CREATE TABLE IF NOT EXISTS tickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('spot', 'perp')),
  bid REAL,
  ask REAL,
  last REAL,
  high24h REAL,
  low24h REAL,
  volume24h REAL,
  quote_volume24h REAL,
  change24h REAL,
  percentage24h REAL,
  funding_rate REAL,
  open_interest REAL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tickers_symbol_exchange_time
  ON tickers(symbol, exchange, created_at DESC);

-- 2. markets: Market info
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('spot', 'perp')),
  active INTEGER DEFAULT 1,
  exchange TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(symbol, exchange, type)
);

-- 3. price_alerts: User alerts
CREATE TABLE IF NOT EXISTS price_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  price_target REAL NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('above', 'below')),
  active INTEGER DEFAULT 1,
  triggered_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- 4. arbitrage_opportunities
CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  buy_exchange TEXT NOT NULL,
  sell_exchange TEXT NOT NULL,
  buy_price REAL NOT NULL,
  sell_price REAL NOT NULL,
  profit_percentage REAL NOT NULL,
  detected_at INTEGER DEFAULT (unixepoch())
);

-- 5. Auto-update triggers (SQLite syntax)
CREATE TRIGGER IF NOT EXISTS update_tickers_updated_at
  AFTER UPDATE ON tickers
  FOR EACH ROW
  BEGIN
    UPDATE tickers SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_markets_updated_at
  AFTER UPDATE ON markets
  FOR EACH ROW
  BEGIN
    UPDATE markets SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_price_alerts_updated_at
  AFTER UPDATE ON price_alerts
  FOR EACH ROW
  BEGIN
    UPDATE price_alerts SET updated_at = unixepoch() WHERE id = NEW.id;
  END;
