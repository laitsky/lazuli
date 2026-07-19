# Full-history OHLCV backfill

Lazuli stores compressed monthly OHLCV objects in R2 and keeps campaign, task,
coverage, and checksum state in D1. The default campaign freezes the top 50
active symbols per exchange and market type for `1h`, `4h`, and `1d`, starting
at `2019-01-01` and ending at the last fully closed UTC month.

## Operator setup

From `apps/api`, install an environment-specific signing secret into macOS
Keychain and the Worker without printing it:

```bash
bun run backfill:campaign secret-set --env staging
```

Use `--env production` only after staging acceptance and the production D1
backup/migration gate.

## Plan and start

```bash
bun run backfill:campaign plan --env staging
bun run backfill:campaign start --env staging
bun run backfill:campaign watch --env staging --campaign bfc_...
```

The planner freezes its universe and splits it into components below the
5,000-task job ceiling. Only one component per exchange runs at a time; exchange
coordinators pace provider requests independently.

## Controls and recovery

```bash
bun run backfill:campaign pause --env staging --campaign bfc_...
bun run backfill:campaign resume --env staging --campaign bfc_...
bun run backfill:campaign retry-gaps --env staging --campaign bfc_...
bun run backfill:campaign verify --env staging --campaign bfc_...
```

Rate limits and transient storage failures are retried with bounded jitter.
Validation failures terminate immediately. Provider failures that exhaust the
retry budget become declared coverage gaps and do not block healthy exchanges.
Investigate the provider circuit and D1 `failure_class` before retrying gaps.

Never delete failed jobs: they are operational evidence. A retry creates a new
bounded job while preserving the prior failure record.

## Production gate

1. Record a D1 Time Travel bookmark and deployed Worker version.
2. Apply every pending additive migration, including `0013_backfill_campaigns.sql`.
3. Deploy the Worker and run one-symbol, one-month pilots for each reachable provider.
4. Verify positive row counts, R2/D1 checksum agreement, valid gzip NDJSON, and archived API reads.
5. Start the full campaign only while live-data and storage SLOs remain healthy.

Binance or another unreachable provider is recorded as a repairable campaign gap.
Do not route high-frequency candle rows into D1 or bypass the coordinator.

## Multi-dataset history campaigns

Migration `0014_historical_data_campaigns.sql` adds the generic control plane for funding rates and basis, open interest, Deribit volatility, hourly trade/liquidation aggregates, macro observations, ETF flows, and catalog snapshots. Gzip NDJSON payloads live under `history/v1/dataset=...`; D1 contains manifests, campaign state, declared gaps, and bounded query rollups.

```bash
bun run backfill:campaign history-plan --env staging --payload '{"datasets":["macro","etf_flow","market_catalog"]}'
bun run backfill:campaign history-start --env staging --payload '{"datasets":["options_volatility"],"assets":["BTC"]}'
bun run backfill:campaign history-watch --env staging --campaign hfc_...
bun run backfill:campaign history-verify --env staging --campaign hfc_...
```

The matching controls are `history-pause`, `history-resume`, `history-cancel`, and `history-retry-gaps`. Provider-unavailable and no-data partitions are evidence and never contain fallback/demo observations. Liquidation history remains a declared gap until an exchange-native pagination adapter passes its pilot.

Keep `HISTORY_DAILY_REFRESH_ENABLED=false` during pilots. Enable it in staging only after macro, ETF, and catalog partitions pass verification; leave production disabled until the production pilot gate. The scheduled refresh creates at most one daily macro/ETF/catalog campaign.

```bash
bun run backfill:campaign history-refresh-run --env staging
bun run backfill:campaign history-refresh-status --env staging
```

Daily refreshes are capped by `HISTORY_DAILY_TASK_BUDGET=10` and `HISTORY_DAILY_ATTEMPT_BUDGET=30`. `HISTORY_DAILY_EXCLUDED_PROVIDERS` is an emergency comma-separated exclusion list and is empty by default. Current-month objects are checksum-validated and merged; finalized closed-month objects are reused without changing content. Keep the staging flag enabled for one clean 24-hour scheduled cycle before applying the migration or enabling the flag in production.
