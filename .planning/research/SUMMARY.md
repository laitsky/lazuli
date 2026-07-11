# Project Research Summary

**Project:** Lazuli — Edge-Native Crypto Market Intelligence Platform
**Domain:** Real-time liquidations, derivatives analytics, push alerts
**Researched:** 2026-07-11
**Confidence:** HIGH

## Executive Summary

Lazuli is an edge-native crypto market intelligence platform that competes with Coinglass ($28/mo), Coinalyze ($11/mo), and Laevitas ($50/mo) on three axes: latency (sub-800ms liquidation alerts vs. 5–15s for competitors), breadth (options Greeks + vol surface + CVD, free, vs. paywalled), and stickiness (server-side Signal Lab with auto-backtest — unique in the space). The stack is already deployed and locked: Cloudflare Workers + Durable Objects + D1 + R2 + Queues + Workflows. This is not a greenfield recommendation — the research documents the live reality and enforces the patterns already established.

The recommended approach is to build in strict dependency order. RealtimeHubV2DO exists but has no producer; MarketDataCacheV2DO exists but liquidation math (A1) is unbuilt; the `price_alerts` D1 table exists but is unwired (E2). Phase 1 is entirely infrastructure completion — A0 (exchange ingest → DO publish), E2 (event-bus wiring), E3 (Greeks), E4 (backfill), E5 (Binance geo-resolution). Nothing in Phase 2 is buildable without Phase 1 complete. The dependency graph is strict and must be respected.

The two highest-risk items are (1) the Binance geo-block (E5) — unresolved, it silently corrupts every downstream aggregate calculation, and (2) DO hibernation state eviction — if subscriber state is stored in-memory instead of DO storage, WebSocket clients silently stop receiving messages after traffic lulls. Both must be addressed in Phase 1 before any Phase 2 calculation feature is merged. The latency moat is architectural and real, but only if the A0→A1→A3 pipeline is instrumented end-to-end with p95 < 800ms as a hard KPI gate.

## Key Findings

### Recommended Stack

The stack is locked by deployed infrastructure. All Cloudflare-native primitives are already in use — switching any of them would require architectural surgery. The key insight is that the latency advantage over competitors is structural, not algorithmic: Durable Objects eliminate the external broker round-trip that any non-Cloudflare architecture would require, D1 co-located reads are ~1ms vs. ~10ms for non-edge databases, and R2 zero-egress fees make OHLCV archive reads cost-free from Workers.

**Core technologies:**

- **Cloudflare Workers + Durable Objects**: Edge compute + stateful singletons — the only primitive giving consistent in-memory state at the edge without an external broker; WebSocket hibernation keeps idle cost near zero
- **Hono ^4.12**: HTTP framework — Workers-native, ~14kB, first-class Cloudflare env typing; no viable alternative
- **CCXT ^4.5**: Exchange client — unified API across Binance/Bybit/OKX/Hyperliquid/Upbit; only library covering all 5 target exchanges under one abstraction
- **Cloudflare D1**: Control-plane SQLite — additive-only migrations enforced; ~1ms reads from Workers
- **Cloudflare R2**: OHLCV archive — zero egress fees from Workers; monthly NDJSON partitions by `{exchange}/{symbol}/{type}/{timeframe}/{YYYY-MM}.ndjson`
- **Cloudflare Queues + Workflows**: Durable async — BackfillWorkflow fans out to BACKFILL_QUEUE; at-least-once delivery with DLQ
- **React 18 + Vite 6 + TailwindCSS 4**: Frontend — Vite 6 / Tailwind v4 (Oxide) are significantly faster than their predecessors; lightweight-charts is the only charting lib that handles 10K+ candles at sub-frame render
- **Bun ^1.1.38**: Package manager — `packageManager` is set; do not switch to npm/yarn/pnpm

**Critical version constraints:**

- `zod@^4.4` requires `@hono/zod-validator@^0.8` (Zod v4 changed `parse` return type)
- `@simplewebauthn/server@^13` — v13 removed Node crypto deps that broke Workers; earlier versions will not work
- `tailwindcss@^4` requires `@tailwindcss/postcss` plugin, not `tailwindcss` directly in postcss.config.js
- `ccxt@^4.5` ships ESM; must bundle via Wrangler's esbuild step; verify each exchange under `nodejs_compat`

### Expected Features

See [FEATURES.md](.planning/research/FEATURES.md) for full prioritization matrix and competitor analysis.

**Must have (table stakes — P1, Phases 1–3):**

- Real-time price tickers (multi-exchange) — absence is disqualifying
- Live liquidation feed with cascade-level math — core product claim
- Liquidation heatmap — Coinglass's signature visual; users expect it
- Funding rate + open interest display — standard perp dashboard
- Push alerts via Telegram/Discord/Webhook — stated core value
- Public WebSocket endpoints — latency moat requires external measurement
- Historical OHLCV charts — baseline for any trading tool

**Should have (competitive differentiators — P2, Phases 4–5):**

- Sub-800ms alert delivery (instrumented, not assumed)
- Options Greeks via Black-Scholes on Deribit IV — Laevitas charges $50/mo; Lazuli free
- CVD / cumulative volume delta — cleaner UX than Coinalyze
- Backtesting engine on R2 archive (equity curve, Sharpe, drawdown)
- Server-side Signal Lab with auto-backtest on save — unique in the space; the stickiness feature
- Accounts + magic-link/passkey auth + saved workspaces
- Shareable snapshots with OG images — viral growth driver (infra already exists)
- Vol surface + term structure (B4) — institutional-grade, currently $50/mo at Laevitas
- Public Alpha Feed (SEO + RSS) — organic discoverability

**Defer (v2+, post-90 days):**

- Monetization / pro tier — only after 90-day retention data proves PMF
- API key issuance (D5) — B2B hook post-PMF
- Screener with derivatives dimensions (C1) — growth polish, not a launch driver
- Funding arbitrage with basis curve (C2) — niche carry-trade feature
- Stochastic vol models (SABR/Heston) — only if B4 validates institutional demand

**Hard anti-features (do not build):**

- Native iOS/Android app — push via Telegram/Discord solves the problem without the maintenance burden
- Password authentication — password database is a liability; magic-link + passkey is the constraint
- Social sentiment (Twitter/Reddit) — paid API, unreliable signal, ToS risk
- Copy trading / execution — out of scope; brokerage licensing required

### Architecture Approach

The architecture is a hub-and-spoke edge system where all real-time state lives in two Durable Objects (MarketDataCacheV2DO for exchange data, RealtimeHubV2DO for WebSocket pub/sub), all persistent metadata lives in D1, all OHLCV history lives in R2, and all long-running async work goes through Queues + Workflows. The Worker (Hono) is stateless and proxies to DOs for anything requiring state. This design eliminates every external service (no Redis, no Pusher, no Kafka, no external DB) and is the source of the cost and latency advantage.

See [ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) for full system diagram, data flows, and anti-patterns.

**Major components:**

1. **RealtimeHubV2DO** — WebSocket pub/sub broker; 256-event rolling buffer; topic-scoped broadcast; hibernation-safe; **producer side (exchange ingest) is missing — this is A0**
2. **MarketDataCacheV2DO** — 48 MB bounded in-memory cache; stale-while-revalidate TTL policies; serializes exchange fan-in to prevent rate limit hammering
3. **marketIntelligenceService** — liquidation math, CVD, RSI, backtesting, signal evaluation; **A1 (liquidation engine) is the core unbuilt service**
4. **growthRetentionService** — auth (magic-link/passkey), sessions, API keys, watchlists, workspaces, alerts; **wired to D1 but alert delivery (E2→A3) is not yet connected**
5. **BackfillWorkflow + BACKFILL_QUEUE** — durable async orchestration for OHLCV archive; **E4 backfill window is broken (2019–2020 cap issue)**
6. **React SPA** — market workspace, heatmap, options surface, signal lab UI; served via Workers Static Assets

### Critical Pitfalls

See [PITFALLS.md](.planning/research/PITFALLS.md) for full recovery strategies, "looks done but isn't" checklist, and performance traps.

1. **DO hibernation evicts in-memory subscriber state** — use `ctx.acceptWebSocket(ws)` (hibernation API) and store subscription topics in DO `storage`, not in-memory Maps; must be correct in A0 before A1/A4 build on top of it
2. **Binance geo-block unresolved poisons all aggregates** — E5 must produce a binary outcome (works or explicitly excluded with UI disclosure) before any Phase 2 aggregate calculation is written; `if (binanceAvailable)` scattered across A1/A5/B1 is the failure mode
3. **Exchange rate limits silently collapse backfill queues** — use a per-exchange rate-limiter DO as token bucket; set Queue consumer `maxConcurrency=1` per exchange; add DLQ for failed tasks
4. **Liquidation math on mismatched OI timestamps gives wrong cascade levels** — fetch OI + mark price in the same batch or from the same WS feed; timestamp each input and refuse computation if inputs are > 5s apart
5. **D1 additive-only migration debt compounds into schema rot** — every `ALTER TABLE ADD COLUMN` needs a migration comment (`-- added:`, `-- wired:`, `-- backfill:`); `price_alerts` unwired state is a warning sign this pattern is already emerging

## Implications for Roadmap

### Phase 1: Infrastructure Completion + Blockers

**Rationale:** Everything in Phases 2–6 depends on A0 (exchange ingest → DO), E2 (event-bus wiring), E5 (Binance resolution), E3 (Greeks foundation), and E4 (backfill fix). None of these are user-facing features — they are load-bearing foundations. Building any Phase 2 feature before this phase is complete produces wrong results silently.
**Delivers:** Working exchange ingest pipeline, wired event bus, resolved Binance status, correct Greeks from Deribit IV, fixed OHLCV backfill window, KPI instrumentation baseline
**Addresses:** A0, E2, E3, E4, E5
**Avoids:** Binance geo-block poisoning aggregates; DO hibernation state loss; backfill queue collapse; null-IV Greeks

**Research flag:** Standard Cloudflare patterns — no additional research needed. Verify Binance 451 handling and DO hibernation API behavior against official docs.

### Phase 2: Liquidation Engine + Real-Time Core

**Rationale:** A0 complete means the ingest pipeline exists. A1 (cascade liquidation math) is the core product claim. A2 (heatmap) is visual proof. A5 (OI-weighted funding) completes the perp data layer. All depend on Phase 1 foundations.
**Delivers:** Liquidation cascade engine with accurate cascade levels, liquidation heatmap overlay, OI-weighted funding aggregation with spike radar, public WebSocket endpoints (A4)
**Addresses:** A1, A2, A4, A5
**Avoids:** Mismatched OI timestamps (use same-source batch); DO fanout CPU limits (benchmark at 2k connections before A4 goes live)

**Research flag:** A1 cascade math is domain-specific — needs research into perp leverage distribution formulas per exchange. Suggest `--research-phase` for Phase 2 planning.

### Phase 3: Alert Delivery + KPI Validation

**Rationale:** A3 (push alerts) is the stated core value. E2 wired in Phase 1 means the event bus is live. A1 in Phase 2 means liquidation events fire. A3 closes the loop. This is the MVP completion gate — if 5,000 alert subscribers don't materialize or p95 > 800ms, the roadmap should be re-evaluated before Phases 4–6.
**Delivers:** Telegram/Discord/Webhook/Email alert delivery, idempotent alert fanout via Queue, SSRF-protected webhook validation, end-to-end p95 latency instrumented, KPI dashboard via Analytics Engine
**Addresses:** A3, KPI gates
**Avoids:** SSRF via webhook URL (validate scheme + deny RFC-1918); alert fanout idempotency (duplicate queue messages → single notification); alert delivery synchronous calls (fan out via Queue)

**Research flag:** Standard webhook delivery pattern — no additional research needed. Security checklist: SSRF, HMAC signing, idempotency keys.

### Phase 4: Order Flow + Derivatives Intelligence (CVD + Greeks Production)

**Rationale:** Triggered by Phase 3 KPI validation (alert subscriber retention > 30-day). B1 (CVD) requires A0's trade-tape stream. E3 Greeks from Phase 1 are validated here with B4 vol surface. This phase targets the derivatives-sophisticated user segment (separate from liquidation-alert subscribers).
**Delivers:** CVD / cumulative volume delta from live trade tape, Black-Scholes Greeks in production UI, vol surface + term structure (B4), macro confluence dashboard (BTC.D, stablecoin supply, Fear & Greed)
**Addresses:** B1, B4, B5
**Avoids:** CVD tape accumulation in DO storage (compute incremental delta only; never store raw tape); B-S from null IV (E3 validation gate must be green before B4 ships); CoinGecko endpoint instability (pin versioned endpoint, add schema validation)

**Research flag:** B4 vol surface interpolation (cubic spline vs. linear) is niche domain knowledge — suggest `--research-phase` for Phase 4 planning.

### Phase 5: Accounts + Persistence + Viral Growth

**Rationale:** D1 accounts (D1 the feature, not the database) unlock saved workspaces, watchlists, and shareable snapshots. D3 shareable snapshots are a viral growth driver — screenshot infra is already built. D4 Alpha Feed drives organic SEO traffic. This phase should be triggered by user demand signals (D3 share link usage, D4 RSS subscriptions).
**Delivers:** Magic-link + passkey auth with session revocation, saved workspaces/watchlists/alert configs, shareable snapshot URLs with OG images, Public Alpha Feed (signals as RSS + indexable stream), accounts feature-flagged behind `ACCOUNT_FEATURES_ENABLED`
**Addresses:** D1 (auth), D2, D3, D4
**Avoids:** Ghost sessions without revocation (build `revoked_at` column into schema from day one); magic-link tokens in URL query params (use fragment or immediate server-side consume); snapshot URLs exposing private alert configs (strip account-linked data before serializing)

**Research flag:** @simplewebauthn/server v13 Workers compatibility is confirmed — no additional research needed. WebAuthn challenge flow is standard.

### Phase 6: Backtesting + Signal Lab + Market Workspace Polish

**Rationale:** B2 (backtesting) requires E4's corrected R2 archive (Phase 1). B3 (Signal Lab) requires B2. C3 (Market Workspace unified cockpit) is a composition of A1 + B1 + A5 — all must be independently shipped before the unified overlay makes sense. C1 (screener) is Phase 6 polish.
**Delivers:** Backtesting engine on R2 OHLCV archive (equity curve, Sharpe, max drawdown, win-rate), server-side Signal Lab with auto-backtest on save, Market Workspace unified cockpit (liq heatmap + CVD + OI overlay), screener with RSI + derivatives dimensions
**Addresses:** B2, B3, C1, C3
**Avoids:** Unbounded OHLCV query for backtests (monthly R2 partition layout enforced in E4); survivorship bias in backtest UI (display disclaimer for delisted pairs); OG image generation on request (pre-generate via Queue, serve from R2)

**Research flag:** B2 backtesting engine design (streaming R2 reads, equity curve math) is non-trivial — suggest `--research-phase` for Phase 6 planning.

### Post-90d: Monetization + API Key Issuance + SEO Landing Pages

**Rationale:** Only after 90-day retention data shows PMF. D5 (API keys) creates a B2B monetization path. D6 (per-symbol SEO landing pages) drives organic growth flywheel. Pro tier gating should be based on retention metrics, not arbitrary timeline.
**Delivers:** API key issuance with per-key rate limiting, key hash storage (never plaintext), SEO landing pages per symbol with live ticker embeds, monetization infrastructure
**Addresses:** D5, D6, monetization
**Avoids:** API keys stored as plaintext in D1 (store HMAC-SHA256 hash only); SEO pages with no live data preview (embed lightweight ticker widget); paid tier before PMF kills growth flywheel

---

### Phase Ordering Rationale

- **Phase 1 before everything:** The dependency graph has no flexibility. A0 is required by A1, A4, B1. E2 is required by A3 and D2. E5 must have a binary resolution before any aggregate is written. E4's backfill window fix must precede B2. These are not soft dependencies.
- **Phase 3 as MVP gate:** The core product promise is "liquidation alerts before Coinglass refreshes." Phase 3 completes this promise and provides the KPI signal (subscriber count, p95 latency) to decide whether Phases 4–6 are on the right track or need re-prioritization.
- **Phase 4 triggered by Phase 3 KPIs:** Building derivatives intelligence before confirming the alert subscriber base exists is premature optimization. B1/B4 target a different user segment (options/derivatives traders); validate demand via Alpha Feed engagement before committing engineering cycles.
- **Phase 5 triggered by demand signals:** Accounts add complexity (auth, sessions, revocation). Build only when users are demonstrably trying to persist state (proxy: D3 share link usage suggests users want to bookmark/share).
- **Phase 6 as stickiness layer:** Signal Lab is the stickiness feature but it's high-complexity (B2 → B3 dependency chain). Ship it only after the simpler stickiness mechanisms (saved alerts, workspaces from Phase 5) have been validated.

### Research Flags

Phases likely needing deeper research during planning (`/gsd:plan-phase --research-phase <N>`):

- **Phase 2:** Cascade liquidation math — perp leverage distribution formulas and cascade level computation are exchange-specific and not well-documented in CCXT; needs dedicated research
- **Phase 4:** Vol surface interpolation — cubic spline vs. linear interpolation trade-offs for B4; Deribit IV grid coverage per expiry is domain-specific
- **Phase 6:** Backtesting engine architecture — streaming R2 reads, NDJSON parse performance at monthly file sizes (50–200 MB), equity curve math with partial fills

Phases with standard patterns (skip research-phase):

- **Phase 1:** Cloudflare platform patterns are officially documented; DO hibernation API, Queue consumer config, Wrangler bindings are stable
- **Phase 3:** Webhook delivery with HMAC signing is a solved problem; Telegram/Discord Bot API patterns are well-documented
- **Phase 5:** WebAuthn (passkey) flow via @simplewebauthn/server v13 is confirmed Workers-compatible with official docs; magic-link auth is standard

## Confidence Assessment

| Area         | Confidence                              | Notes                                                                                                                            |
| ------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH                                    | Documented from live deployed codebase; package.json and wrangler.jsonc are authoritative sources                                |
| Features     | HIGH                                    | Competitor feature sets are publicly observable; PROJECT.md requirements are explicit; feature dependency graph is deterministic |
| Architecture | HIGH                                    | Based on existing service files (RealtimeHubDO.ts, MarketDataCacheDO.ts, backfillService.ts) + Cloudflare official docs          |
| Pitfalls     | HIGH (platform), MEDIUM (exchange APIs) | Cloudflare limits are official-doc confirmed; exchange rate limit behavior varies by exchange and API tier                       |

**Overall confidence:** HIGH

### Gaps to Address

- **Binance geo-block resolution (E5):** Binary outcome required. Until E5 is resolved, all aggregate calculations must be explicitly scoped to non-Binance exchanges. This is the highest-priority unknown in the project.
- **DO fanout benchmark at 2k connections:** Theoretical capacity is documented (shard at ~500 connections/DO); actual benchmark at target scale has not been run. Must validate before Phase 3 alert delivery goes live.
- **CCXT bundle size in Workers:** Tree-shaking CCXT v4 ESM has community-known issues; the exact bundle size after Wrangler's esbuild step should be verified (`wrangler deploy --dry-run` with size logging) before assuming it fits within the 10 MB Worker limit.
- **Exchange WebSocket keepalive behavior:** Deribit closes idle connections after ~60s; Binance/Bybit/OKX behavior is not consistently documented. Reconnect logic in the ingest DO (A0) must handle all five exchanges' specific timeout behaviors.
- **R2 monthly partition read performance:** Monthly NDJSON files at 50–200 MB are within documented R2 limits but streaming NDJSON parse performance inside a Worker's 30s CPU budget has not been benchmarked for the B2 backtest use case.

## Sources

### Primary (HIGH confidence)

- Live codebase: `apps/api/package.json`, `apps/web/package.json`, `apps/api/wrangler.jsonc` — stack versions, bindings, feature flags
- Cloudflare Workers docs: https://developers.cloudflare.com/workers/ — Durable Objects, D1, R2, Queues, Workflows, Analytics Engine, Rate Limiting, CPU limits
- PROJECT.md — requirements, constraints, competitor positioning (authoritative for this project)

### Secondary (MEDIUM confidence)

- CCXT v4 changelog and exchange support matrix: https://github.com/ccxt/ccxt — bundle size behavior under tree-shaking
- Deribit API docs — WebSocket 60s idle timeout, IV grid structure per expiry
- Competitor feature analysis: Coinglass, Coinalyze, Laevitas — pricing and feature gaps from public product pages
- Exchange rate limit documentation: Binance/Bybit/OKX public API docs — throttle thresholds vary by endpoint tier

### Tertiary (LOW confidence)

- CCXT bundle size in Workers: community knowledge, not officially documented — validate with `wrangler deploy --dry-run`
- Exchange WebSocket timeout behavior beyond Deribit: inferred from community reports, needs empirical validation in A0

---

_Research completed: 2026-07-11_
_Ready for roadmap: yes_
