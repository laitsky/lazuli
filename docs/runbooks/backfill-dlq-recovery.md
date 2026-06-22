# Backfill DLQ Recovery Runbook

## Symptoms

- Queue messages reach `lazuli-backfill-dlq-*`.
- Backfill job has failed tasks after the terminal retry limit.
- R2 manifests are incomplete for a requested archive range.

## Immediate Actions

1. Inspect failed task IDs, exchange, symbol, timeframe, attempts, and last error in D1.
2. Separate terminal validation failures from transient exchange/storage failures.
3. Do not replay the DLQ blindly; retry only after the underlying cause is understood.

## Recovery

1. For transient failures, use the signed admin retry endpoint for the affected job.
2. For malformed jobs, create a smaller replacement job with explicit exchange, symbol, type, timeframe, and date range.
3. Verify the R2 archive object, checksum, row count, and gap summary after retry.
4. Mark persistent exchange coverage gaps in release notes or operational tracking.
