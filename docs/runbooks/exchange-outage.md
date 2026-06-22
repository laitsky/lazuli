# Exchange Outage Runbook

## Symptoms

- Elevated `EXCHANGE_*` errors in API logs.
- `meta.cache.stale=true` or empty fallback payloads for one exchange.
- Durable Object cache refresh failures for one exchange/resource.

## Immediate Actions

1. Confirm the affected exchange and resource from Analytics Engine and worker logs.
2. Check whether stale cache is being served; public reads should continue with `meta.cache.stale`.
3. Reduce user-facing refresh pressure by lowering frontend polling if the outage is prolonged.
4. Pause or avoid backfills for the affected exchange until public API calls recover.

## Recovery

1. Watch for the circuit breaker to half-open after its cooldown.
2. Confirm fresh cache updates for tickers, funding, OHLCV, and orderbook.
3. Resume paused backfill jobs through signed admin retry endpoints if needed.
4. Record the outage window and any missing archive coverage.
