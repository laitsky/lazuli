# Lazuli Roadmap Status

This document mirrors the live Cloudflare-native implementation. Older Bun + Elysia + Supabase assumptions are retired.

**Release channel:** Beta (`0.1.0-beta.0`). This is a controlled-evaluation label, not production verification. Production flags remain off and the unchecked acceptance work below is intentionally deferred rather than represented as passed.

## Completed Platform Capabilities

- [x] Hono API on Cloudflare Workers
- [x] React + Vite web app on Cloudflare
- [x] CCXT live exchange integration for Binance, Bybit, OKX, Hyperliquid, and Upbit
- [x] D1 metadata/control-plane storage
- [x] R2 historical OHLCV archive
- [x] Durable Object market cache, rate limiter, and realtime hub
- [x] Queue/Workflow backfill control plane
- [x] Signed admin API for health and backfill operations
- [x] Technical indicators, multi-timeframe OHLCV, custom pairs, custom indexes, SuperEMA
- [x] Screener technical/derivatives filters and trending volume spikes
- [x] Funding radar, funding arbitrage, price arbitrage, liquidation radar, order-flow proxy
- [x] Institutional ETF flows, options chain, IV history, Black-Scholes Greeks, and confluence
- [x] Server-side backtesting endpoint

## Completed Track D/E Work

- [x] Passwordless magic-link accounts
- [x] D1 sessions, users, saved workspaces, watchlists, alerts, backtests, and API keys
- [x] Event-driven alert evaluation, atomic trigger claims, and realtime topic publication
- [x] Public Alpha Feed endpoint and page
- [x] Shareable market snapshot SVG endpoint
- [x] SEO-style web routes for exchange, symbol, and signal permalinks
- [x] OpenAPI updates for auth, saved state, API keys, Alpha Feed, and snapshots
- [x] Backfill defaults changed to 2019 through current time
- [x] Default backfill symbol universe capped to top 50 active markets by live volume
- [x] Binance enabled with documented regional degradation behavior

## Remaining High-Value Work

- [x] Scheduled/cron alert evaluation
- [x] Delivery relay fan-out beyond realtime topic publish
- [x] Telegram, Discord, email, and webhook delivery adapters
- [x] Server-side passkey/WebAuthn registration and login flows
- [x] Persisted Signal Lab strategy versions and latest auto-backtest snapshots
- [x] Historical Alpha Feed event pages backed by D1 records
- [x] More OpenAPI concrete schemas for new response payloads
- [x] API key usage metering and tiered rate limits
- [x] Expanded route smoke tests for Track D endpoints
- [x] Browser visual verification snapshots for new web pages

## Verification

Repository implementation is not the production completion gate. The following operational acceptance remains open until sanitized reports and live dashboard/flag evidence are attached to the strategy ledger:

- [ ] Execute the 2,000-client/60-minute realtime load gate in staging.
- [ ] Execute and review the reconnect-storm test with provider reconciliation.
- [ ] Complete a continuous 72-hour staging soak with no unexplained gaps or unbounded memory growth.
- [ ] Run provider, D1/R2, Queue/DLQ, secret-rotation, migration, restart, and rollback drills.
- [ ] Verify every required SLO dashboard and alert is live and owned.
- [ ] Roll independent production flags through internal, 5%, 25%, and 100% cohorts.
- [ ] Reach 26/26 production-verified strategy ledger entries.

See [operations and acceptance](./operations/README.md) for the executable harness and runbooks.

## Local checks

Run:

```bash
bun run --filter @lazuli/api type-check
bun run --filter @lazuli/api test
bun run --filter @lazuli/web type-check
bun run lint
bun run format:check
```
