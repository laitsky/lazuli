# D1/R2 Failure Runbook

## Symptoms

- `/api/v1/admin/health` reports D1 or R2 unavailable.
- Backfill tasks fail before writing manifests or archive objects.
- Historical OHLCV requests return missing archive metadata.

## Immediate Actions

1. Confirm Cloudflare incident status for D1 or R2 in the affected region/account.
2. Stop creating new backfill jobs until storage recovers.
3. Keep public live-data endpoints online; they should continue through exchange reads and live cache.
4. Preserve queue messages by allowing transient failures to retry instead of acknowledging them.

## Recovery

1. Run admin health and verify D1, R2, Queue, Workflow, and Durable Object bindings.
2. Inspect failed backfill tasks and retry through `POST /api/v1/admin/backfills/:id/retry`.
3. Spot-check R2 object checksums and D1 manifests for the outage window.
4. Document whether any archive gaps need a targeted backfill.
