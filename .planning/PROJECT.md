# Lazuli

## What This Is

Lazuli is an edge-native crypto market intelligence platform that delivers real-time liquidation data, derivatives analytics, and push alerts entirely free to retail traders. It runs on Cloudflare Workers and Durable Objects to achieve latency that legacy aggregators like Coinglass cannot match architecturally. The 90-day build plan ships Coinglass's liquidation depth, Laevitas's institutional Greeks, and Coinalyze's order-flow intelligence as a single unified platform at $0.

## Core Value

Real-time liquidation alerts delivered to your phone before Coinglass's dashboard refreshes — at zero cost forever.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**Phase 1 — Contracts, Infrastructure, Source-of-Truth** _(Wk 1–3)_

- [ ] E1: Regenerate `AGENTS.md`, `TODO.md`, `api-spec.yaml` from live code so agents ship on correct assumptions
- [ ] E2: Wire the dead `price_alerts` table into an event-bus skeleton (CRUD + D1 schema additive migration)
- [ ] E3: Compute options Greeks (delta, gamma, vega, theta) from Deribit IV via Black-Scholes; no more null Greeks
- [ ] E4: Fix backfill window from the broken 2019–2020 cap to full available exchange history; backfill top 50 pairs
- [ ] E5: Re-enable or formally document geo-handling for Binance; biggest exchange must be in a known state
- [ ] A0: WebSocket broker — Durable Object pub/sub + `/ws` endpoint; foundation for all real-time tracks

**Phase 2 — Cloudflare Container Realtime Platform** _(Wk 3–7)_

- [ ] A1: Liquidation engine — cascade-level math from perp OI + mark price + leverage across exchanges
- [ ] A4: Public WebSocket endpoints for tickers, liquidations, order-book deltas, and alerts (latency moat)
- [ ] A5: OI-weighted funding rate aggregation + open-interest spike radar
- [ ] A2: Liquidation heatmap UI overlay on Market Workspace

**Phase 3 — Liquidation Alerts** _(Wk 5–8, parallel with Phase 2)_

- [ ] A3: Push alert delivery — Telegram, Discord, Webhook, Email via event bus wired to E2
- [ ] Adoption KPI: push-alert subscriber count instrumented in Analytics Engine (target: 5,000; not a gate)
- [ ] Adoption KPI: liquidation-feed p95 latency < 800 ms measured and dashboarded

**Phase 4 — Derivatives Intelligence** _(Wk 5–10)_

- [ ] B1: CVD / order-flow / footprint computed from trade-tape WebSocket stream (A0 dep)
- [ ] B2: Backtesting engine over R2 OHLCV archive — equity curve, Sharpe, max drawdown, win-rate (E4 dep)
- [ ] B3: Server-side Signal Lab with versioning + auto-backtest on save; signals must survive refresh (B2 dep)
- [ ] B4: Options term structure + vol surface — ATM IV curve, skew, walls (E3 dep)
- [ ] B5: Confluence macro expansion — add BTC.D, stablecoin supply, Fear & Greed index

**Phase 5 — Accounts, Persistence, API Growth & Hybrid Edge SEO** _(Wk 7–11)_

- [ ] D1: Accounts + auth via magic-link / passkey (no password database)
- [ ] D2: Saved workspaces, watchlists, alerts, and backtests tied to account (D1 + E2 dep)
- [ ] D3: Viral shareable snapshots + OG-image generation (leverage existing `lib/screenshot.ts`)
- [ ] D4: Public "Alpha Feed" — top signals and alerts as a SEO-indexable + RSS-accessible stream
- [ ] D5: API key issuance + public docs (target: 1,000 keys; instrumented, not a gate)
- [ ] D6: SEO landing pages per symbol, per exchange, per signal — edge-rendered, statically cached
- [ ] Adoption KPI: organic SEO landings instrumented (target: 50k/mo; not a gate)
- [ ] Adoption KPI: WAU baseline measured → 3× growth target set

**Phase 6 — Metrics Hardening & Production Rollout** _(Wk 10–12)_

- [ ] C1: Screener — add technical dimensions (RSI, breakout) + derivatives dimensions (funding rate, OI delta)
- [ ] C2: Funding arbitrage — add basis-curve history and execution-cost-adjusted yield
- [ ] C3: Market Workspace — unified cockpit with liquidation, CVD, and OI overlays
- [ ] C4: Trending / volume-spike detector (24h-vs-7d volume ratio) as a discovery feed
- [ ] Adoption KPI: concurrent WS connections dashboarded (target: 2,000 peak; not a gate)
- [ ] Adoption KPI: backtest runs/week instrumented (target: 10,000; not a gate)
- [ ] Production evidence required: every A0–E5 item needs a live Cloudflare deployment receipt before marking complete

### Out of Scope

- **Monetization / paywalls before Wk 10** — retail stays free for 90 days; pro tier introduced only after retention metrics prove the product; B2B API pricing deferred to post-90-day
- **Password-based auth** — magic-link/passkey only; no password tables, no bcrypt infra to maintain
- **Self-hosted / non-Cloudflare deployment targets** — Durable Objects, R2, D1, and Workers are load-bearing; multi-cloud adds cost and complexity with no user benefit now
- **Paid/proprietary data providers** — Binance, Bybit, OKX, Hyperliquid, Deribit, Farside, Fear & Greed are all free/public; zero data licensing budget in this window
- **Destructive database migrations** — all D1 changes must be additive; no column drops, no table renames that break running Workers
- **Backfilling all exchange pairs** — top 50 pairs only (E4); full catalog would exhaust R2 write budget and stall backfill queues
- **Native mobile apps** — push delivery via Telegram/Discord/Webhook covers mobile without a separate release track
- **Real-time options pricing beyond Black-Scholes** — stochastic vol models (SABR, Heston) are out until B4 validates user demand

## Context

- **Existing architecture**: Cloudflare Workers (Hono), Durable Objects for coordination, D1 for metadata/control-plane, R2 for OHLCV archives, Queues and Workflows for backfill orchestration; React + Vite on Workers Static Assets
- **CCXT integration**: Binance, Bybit, OKX, Hyperliquid, Upbit; Binance currently geo-blocked and in an undefined state — E5 must resolve this before any feature assumes exchange availability
- **Existing dead weight to fix first**: `price_alerts` table never wired (E2), options Greeks always null (E3), backfill window artificially capped (E4), docs misrepresent current stack (E1)
- **Screenshot infra already exists**: `lib/screenshot.ts` is built; D3 is mostly a route + OG meta wiring task, not a net-new build
- **Competitor positioning**: Coinglass (delayed + passive, $28/mo), Coinalyze (niche + steep UX, $11/mo), Laevitas ($50/mo institutional) — undercut all three by being edge-native and free
- **Agent fan-out strategy**: Phase 1 items are fully parallelizable across 6 agents; critical path is `A0→A1/B1`, `E3→B4`, `E4→B2`, `E2→A3/D2`, `D1→D2`
- **KPI instrumentation is non-optional but non-blocking**: every adoption metric must be wired to Cloudflare Analytics Engine by end of Phase 3; missing a KPI target does not block phase completion, but missing the instrumentation itself does

## Constraints

- **Tech Stack**: Cloudflare Workers + Durable Objects + D1 + R2 + Queues — no alternative runtimes; Bun for local tooling only
- **Providers**: Free/public APIs only (Binance, Bybit, OKX, Hyperliquid, Deribit, Farside, CoinGecko Fear & Greed) — zero data licensing budget
- **Migrations**: Additive only — every D1 schema change must be backward-compatible with the currently-deployed Worker; no destructive ALTER TABLE
- **Backward Compatibility**: Public API contracts (`/api/v1/`) are frozen once shipped; new behavior goes on new paths or optional fields, never breaking existing consumers
- **Production Evidence**: No Phase item is marked complete without a verifiable Cloudflare deployment (wrangler deploy receipt or Worker URL returning expected response)
- **Monetization**: Deferred — no paywalls, no rate-limit tiers, no Stripe integration within the 90-day window
- **Timeline**: 90 days hard; 12-week phased execution with parallel agent tracks
- **Security**: No credentials in source; all secrets via `wrangler secret`; no logging of user PII

## Key Decisions

| Decision                                   | Rationale                                                                                                      | Outcome   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------- |
| Retail free forever (90-day scope)         | Growth flywheel requires zero friction; monetize power users post-product-market-fit                           | — Pending |
| Durable Objects as WS broker (A0)          | Edge-native pub/sub with hibernation avoids egress cost of external brokers; architecturally hard to replicate | — Pending |
| Black-Scholes for Greeks (E3)              | Deribit provides IV; B-S is accurate enough for retail and ships in days vs weeks for stochastic models        | — Pending |
| Additive-only D1 migrations                | Running Workers must not break mid-deploy; rollback via revert instead of down-migration                       | — Pending |
| Magic-link / passkey auth only (D1)        | Eliminates password storage liability; aligns with platform-native credential UX                               | — Pending |
| KPIs instrumented but not completion gates | Prevents metric-gaming from blocking feature ship; adoption evidence informs prioritization, not completion    | — Pending |
| Top-50 backfill only (E4)                  | Full catalog would saturate Queue budget; 50 pairs covers 95%+ of likely backtest queries                      | — Pending |
| Free/public providers only                 | Maintains zero COGS on data; forces creative use of exchange APIs rather than paid aggregators                 | — Pending |

---

_Last updated: 2026-07-11 after initial PROJECT.md creation from PRODUCT-STRATEGY.md_
