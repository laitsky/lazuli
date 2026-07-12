-- Migration 0009: processing leases make signed ingest retries recoverable.

ALTER TABLE realtime_ingest_batches
  ADD COLUMN status TEXT NOT NULL DEFAULT 'processing'
  CHECK (status IN ('processing', 'completed'));

ALTER TABLE realtime_ingest_batches
  ADD COLUMN completed_at INTEGER;
