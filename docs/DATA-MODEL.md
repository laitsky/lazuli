# Data model and migration policy

## Storage boundaries

| Store                 | Owns                                                                                                                                                 | Must not own                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Durable Object memory | Bounded topic recovery window, live socket state, short-lived market cache                                                                           | Unbounded event history or canonical user state                                              |
| D1                    | Accounts/sessions, saved objects, alert/channel/job state, ingestion checkpoints, derived rollups, macro snapshots, daily metrics, archive manifests | Every high-frequency trade/book/liquidation event                                            |
| R2                    | Compressed OHLCV archive, streamed backtest results, compressed realtime partitions where enabled                                                    | Mutable job state or secrets                                                                 |
| Queues                | Asynchronous delivery, archive, and backfill messages                                                                                                | Canonical state without an idempotency key                                                   |
| Analytics Engine      | Privacy-minimized operational/product events and latency distributions                                                                               | Credentials, message bodies, email addresses, webhook URLs, or durable source of truth       |
| D1 operational state  | Five-minute SLI rollups, bounded SLI samples, SLO incidents, synthetic probes, paging history, and immutable release-evidence references             | High-frequency market events, browser/admin secrets, Access tokens, or raw provider payloads |

Migration `0007_realtime_intelligence_operations.sql` adds the strategy control-plane entities: `ingestion_checkpoints`, `derived_metric_rollups`, `notification_channels`, `notification_delivery_attempts`, `async_backtest_jobs`, `macro_snapshots`, and `daily_product_metrics`.

Migrations `0008_realtime_security_and_idempotency.sql` and `0009_realtime_ingest_recovery.sql` add alert-trigger uniqueness, signed-batch replay state, recoverable processing/completion leases, and privacy-minimized unique-metric subjects. Liquidation checkpoints retain a bounded native-print recovery snapshot across normal Durable Object hibernation; high-frequency event history remains outside D1.

## Time, identity, and provenance

- Persist UTC epoch seconds in D1 unless an existing table explicitly uses milliseconds; field names and contracts must make the unit unambiguous.
- Realtime events use UUID event IDs, topic-local sequences, exchange/ingest/publish millisecond timestamps, schema version, provider, source kind, and quality.
- Queue write paths use stable idempotency keys. Consumer transactions insert or transition state conditionally so a retry cannot produce a second alert delivery, archive partition, or job result.
- User endpoints and provider secrets are encrypted at rest; API keys, sessions, and one-time tokens are stored only as hashes.
- Derived rollups store assumptions, sample count, source freshness, and provenance alongside values.

## Additive migration policy

All 90-day program migrations are additive. A migration may create a table, index, trigger, or nullable/defaulted column. It must not drop/rename a live table or column, rewrite an unbounded table in place, weaken a constraint, or delete production data.

Each migration must pass both paths:

1. Apply all migrations to an empty local database.
2. Restore a sanitized prior-schema fixture and apply only pending migrations.

Before production, take a D1 backup, record migration identifiers and deployment version, apply to staging, run contract/smoke checks, and then roll forward production. D1 schema rollback is forward-only: deploy compatible code or add a compensating migration. Never edit an applied migration. See [migration runbook](./runbooks/migration-roll-forward.md).

## Retention and erasure

Retention must be configured per environment and documented before flags are enabled. User-owned records cascade or are explicitly deleted during account erasure. Operational evidence uses pseudonymous dimensions. Delivery attempt errors are redacted. R2 lifecycle policies remove expired temporary backtest outputs and raw realtime partitions while preserving declared OHLCV archive coverage.
