# Production Rollback Runbook

## When To Roll Back

- Public API error rate stays elevated after mitigation.
- A deploy breaks cache, D1/R2 access, routing, or admin operations.
- The web Worker serves a broken shell or blocks required API requests.

## Rollback

1. Identify the last known-good deployment in Cloudflare Workers.
2. Roll back the API Worker first if API health or data correctness is affected.
3. Roll back the web Worker if only the frontend shell is affected.
4. Avoid schema rollback unless a migration is confirmed to be the failure source.

## Verification

1. Check `/api/v1/health` publicly.
2. Check `/api/v1/admin/health` with a signed request.
3. Smoke test exchanges, tickers, OHLCV, funding, orderbook, and admin rejection paths.
4. Watch Analytics Engine for recovery in p95 latency and error rate.
