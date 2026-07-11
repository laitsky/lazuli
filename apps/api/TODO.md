# Lazuli API Roadmap

## Current Production Baseline

- [x] Cloudflare Workers API using Hono
- [x] CCXT live adapters for Binance, Bybit, OKX, Hyperliquid, and Upbit
- [x] Durable Object market-data cache
- [x] Durable Object public rate limiter
- [x] Durable Object realtime hub with topic fan-out
- [x] D1 control-plane schema for app config, audit events, users, saved state, alerts, API keys, backfill jobs, and R2 manifests
- [x] R2 OHLCV archive read/write path
- [x] Queues + Workflows backfill orchestration
- [x] Signed admin routes for deep health and backfill control
- [x] Institutional ETF/options/confluence endpoints
- [x] Options Greeks computed from Deribit IV via Black-Scholes
- [x] Liquidation radar, order-flow proxy, funding radar, funding arbitrage, and backtest endpoints
- [x] Public Alpha Feed and market snapshot SVG endpoints
- [x] Passwordless magic-link sessions with production delivery webhook support
- [x] User saved workspaces, watchlists, alerts, backtests, and API keys
- [x] OpenAPI source updated at `src/api-spec.yaml`

## Track D — Growth & Retention

- [x] D1 user accounts and magic-link auth
- [x] Saved workspaces
- [x] Watchlists
- [x] Price alerts backed by D1
- [x] Saved backtests
- [x] Public Alpha Feed
- [x] API key issue/list/revoke endpoints
- [x] Shareable market snapshot SVG generation
- [x] Web SEO routes for `/alpha-feed`, `/markets/:exchange/:symbol`, `/exchanges/:exchange`, and `/signals/:id`

## Track E — Foundation

- [x] Rewrite stale root docs and API TODO
- [x] Update OpenAPI source for Track D/E endpoints
- [x] Wire `price_alerts` into user alerts and realtime event fan-out
- [x] Fill options Greeks from Deribit IV
- [x] Change default backfill window from 2019-2020 to 2019-now
- [x] Default backfill universe to top 50 symbols per exchange/type when symbols are not explicit
- [x] Re-enable Binance support with documented regional availability handling

## Next Engineering Priorities

- [x] Add scheduled alert evaluation so users do not need to call `/me/alerts/evaluate`
- [x] Add alert delivery relay fan-out beyond realtime topic publish
- [x] Add delivery adapters for Telegram, Discord, webhook, and email alert destinations
- [x] Add passkey registration and assertion flows on top of the current user/session tables
- [x] Add server-side Signal Lab persistence/versioning beyond saved backtest snapshots
- [x] Add persisted Alpha Feed events for historical SEO pages
- [x] Add route smoke coverage for auth, saved-state, and Alpha Feed endpoints
- [x] Add OpenAPI schemas for every Track D response object, not just generic success wrappers
- [x] Add API-key rate tiers and usage analytics keyed by `key_prefix`

## Verification Commands

```bash
bun run --filter @lazuli/api type-check
bun run --filter @lazuli/api test
bun run --filter @lazuli/web type-check
bun run lint
bun run format:check
```
