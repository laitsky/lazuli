-- Migration 0017: production hardening for conviction outcome scheduling and
-- walk-forward calibration artifacts. Kept additive so environments that
-- already applied the initial Conviction Engine migration can upgrade safely.

CREATE TABLE IF NOT EXISTS signal_calibration_artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  exchange TEXT NOT NULL,
  market_type TEXT NOT NULL CHECK (market_type IN ('spot','perp')),
  horizon TEXT NOT NULL CHECK (horizon IN ('1h','6h','24h')),
  regime TEXT NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
  calibration_json TEXT NOT NULL CHECK (json_valid(calibration_json)),
  object_key TEXT NOT NULL,
  built_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(kind, exchange, market_type, horizon, regime)
);

CREATE INDEX IF NOT EXISTS idx_signal_calibration_artifacts_lookup
  ON signal_calibration_artifacts(kind, exchange, market_type, horizon, regime, built_at DESC);

ALTER TABLE opportunity_events ADD COLUMN calibration_id TEXT NOT NULL DEFAULT '';
ALTER TABLE opportunity_outcomes ADD COLUMN last_enqueued_at INTEGER;

DROP INDEX IF EXISTS idx_opportunity_outcomes_pending;
CREATE INDEX idx_opportunity_outcomes_pending
  ON opportunity_outcomes(coverage_state, last_enqueued_at, created_at)
  WHERE coverage_state = 'pending';
