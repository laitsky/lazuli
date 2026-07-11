# Realtime provider failure and reconciliation

## Trigger

Provider heartbeat/freshness breach, repeated reconnect, upstream sequence gap, reconciliation failure, or regional blocking.

## Contain

1. Declare the affected provider, feed, symbols, environment, and first stale timestamp. Do not restart every adapter.
2. Confirm other providers and REST polling are healthy. Disable only the failing adapter/topic flag if resource pressure spreads.
3. Mark affected data stale with last observed time and provenance. Do not blend modeled/fallback values into native output.
4. For unexplained book/trade gaps, stop publishing the affected derived stream until reconciliation succeeds.

## Reconcile

1. Allow exponential reconnect with jitter; avoid manual reconnect loops.
2. Fetch the provider REST snapshot through the adapter's rate limiter.
3. Compare checkpoint/upstream sequence, discard buffered deltas at or before the snapshot, and apply only contiguous later deltas.
4. Reset derived rolling windows that cannot be reconstructed, marking their coverage partial.
5. Publish a reset/snapshot boundary and verify browser snapshot recovery.
6. Confirm fresh timestamps, contiguous topic-local broker sequences, and normal latency for at least 15 minutes.

## Recover and close

Restore the adapter flag gradually. Record the missing interval for archive/backfill. Close only after no unexplained gaps remain, dashboards are normal, and fallback labels are correct. Attach redacted logs, checkpoint/snapshot identifiers, and drill/incident times to the acceptance report.

Rollback path: retain REST polling and stale/modelled responses; do not roll back schema or delete checkpoints during an incident.
