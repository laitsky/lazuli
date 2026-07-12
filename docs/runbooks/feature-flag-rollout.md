# Feature-flag rollout and rollback

## Preconditions

The capability has passing automated tests, staging user-flow evidence, populated dashboards, tested alerts, assigned owner, recovery runbook, and a backward-compatible fallback. Database migrations are already applied. No open release-blocking security finding exists.

## Rollout

1. **Internal:** staff/test accounts or internal topics only. Observe at least one peak traffic window.
2. **5%:** stable deterministic cohort. Compare availability, latency, gaps, delivery duplicates, storage/Queue errors, and user-flow conversion with control.
3. **25%:** repeat checks and run one provider/restart drill.
4. **100%:** enable only after the phase gate passes. Continue elevated observation for 24 hours.

Change one independent flag at a time: ingest provider, realtime topic, account, alert evaluation, delivery channel, cron reconciliation, async backtest, or admin operation. Record flag version, cohort, start/end, owner, dashboard, and decision at each step.

## Automatic halt and rollback

Halt on SLO burn, unexplained gap, duplicate delivery, authorization failure, untriaged DLQ age, migration/storage error spike, or missing telemetry. Disable the narrowest flag first. Preserve REST polling, stale cache metadata, modeled liquidation, candle-proxy CVD, and synchronous quick-test paths as applicable. Do not roll back an additive schema.

Verify control traffic, clear/reconcile queues, and retain diagnostic state. Resume at the prior cohort only after root cause, fix, and a repeat staging/canary test are documented.
