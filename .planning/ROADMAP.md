# Roadmap: Lazuli

## Overview

Lazuli ships in five phases. Phase 1 completes the load-bearing infrastructure (WS broker, event bus, Greeks, backfill, error handling) that every subsequent phase depends on. Phase 2 builds the liquidation engine and real-time core — the product's architectural latency moat. Phase 3 closes the MVP loop with push alerts and KPI instrumentation, gating further investment on subscriber and latency evidence. Phase 4 adds derivatives intelligence (CVD, backtesting, Signal Lab, vol surface, macro) for the sophisticated trader segment. Phase 5 adds accounts, viral growth mechanisms, and SEO infrastructure to turn the platform into a compounding growth engine.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Infrastructure completion, WS broker, error handling, and options Greeks foundation — unblocks everything
- [ ] **Phase 2: Liquidation Engine + Real-Time Core** - Cascade liquidation math, public WS endpoints, funding/OI aggregation, heatmap UI
- [ ] **Phase 3: Alert Delivery + MVP Gate** - Push alerts via Telegram/Discord/Webhook/Email, KPI instrumentation for subscriber count and p95 latency
- [ ] **Phase 4: Derivatives Intelligence** - CVD/order-flow, backtesting engine, Signal Lab, options vol surface, macro confluence
- [ ] **Phase 5: Accounts + Growth + Hardening** - Auth, persistence, shareable snapshots, Alpha Feed, SEO landing pages, remaining KPIs

## Phase Details

### Phase 1: Foundation

**Goal**: The exchange ingest pipeline is live, the WS broker handles pub/sub with DO hibernation, the event bus is wired, Binance status is deterministic, Greeks return non-null values, backfill history is uncapped, and every API endpoint returns consistent JSON with structured error responses — zero broken foundations for Phase 2
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, WS-01, WS-02, WS-03, WS-04, WS-05, ERR-01, ERR-02, ERR-03, ERR-04, ERR-05, ERR-06, OPTS-01, OPTS-02
**Success Criteria** (what must be TRUE):

1. WebSocket broker at `/ws` accepts connections, routes events by topic (e.g. `liquidations:BTC`), uses DO hibernation, and reconnects clients after DO eviction without manual re-subscription
2. All `/api/v1/` endpoints return `{ success, data, error, timestamp }` JSON; `/health` returns HTTP 200 with live binding statuses and HTTP 503 if any binding is unreachable
3. `/api/v1/options/:symbol/greeks` returns non-null delta, gamma, vega, and theta for every contract where Deribit IV is available
4. Binance exchange status has a documented binary outcome — confirmed accessible or explicitly geo-fenced with a fallback; no silent CCXT failures from Binance
5. Top 50 trading pairs are backfilled to earliest available exchange history in R2; `AGENTS.md`, `TODO.md`, and `api-spec.yaml` match the deployed Worker
   **Plans**: TBD

### Phase 2: Liquidation Engine + Real-Time Core

**Goal**: The liquidation cascade engine computes accurate price thresholds cross-exchange, the heatmap UI shows live liquidation depth, public WebSocket endpoints stream tickers/liquidations/orderbook, and OI-weighted funding rate aggregation with spike radar is live
**Depends on**: Phase 1
**Requirements**: LIQ-01, LIQ-02, LIQ-03, LIQ-04, LIQ-05, PUBWS-01, PUBWS-02, PUBWS-03, PUBWS-04, PUBWS-05, FUND-01, FUND-02, FUND-03, FUND-04, HEAT-01, HEAT-02, HEAT-03, HEAT-04
**Success Criteria** (what must be TRUE):

1. Liquidation heatmap renders on Market Workspace with per-price-level USD notional, updates in real-time via WS stream, and supports toggling individual exchanges on/off
2. Liquidation events from all configured exchanges are published to the WS broker within 800ms p95 of the triggering exchange tick; one exchange going stale does not drop events from others
3. `/ws/tickers`, `/ws/liquidations`, `/ws/orderbook/:exchange/:symbol` stream live data; invalid symbol or unsupported exchange returns a JSON error frame and closes with code 4000
4. `/api/v1/funding/:symbol` and `/api/v1/oi/:symbol` return OI-weighted aggregates refreshed every 60s; OI spike radar emits events when OI increases >10% in a 1-hour rolling window
   **Plans**: TBD
   **UI hint**: yes

### Phase 3: Alert Delivery + MVP Gate

**Goal**: Push alert delivery is live end-to-end via Telegram, Discord, Webhook, and Email; KPI instrumentation for subscriber count and p95 latency is wired to Analytics Engine; the core product promise ("liquidation alerts before Coinglass refreshes") is fulfilled and measurable
**Depends on**: Phase 2
**Requirements**: ALRT-01, ALRT-02, ALRT-03, ALRT-04, ALRT-05, ALRT-06, ALRT-07, ALRT-08, KPI-01, KPI-02
**Success Criteria** (what must be TRUE):

1. User can create, list, update, and delete liquidation alerts via `/api/v1/alerts` specifying symbol, notional threshold (USD), side, and delivery channel
2. Configured alerts fire via Telegram, Discord, HTTP Webhook, and email within 800ms p95 of the liquidation event timestamp
3. Failed deliveries are retried once after 30 seconds; permanent failures are marked in D1 with an error reason
4. Push-alert subscriber count and liquidation-feed end-to-end p95 latency are written to Cloudflare Analytics Engine and queryable
   **Plans**: TBD

### Phase 4: Derivatives Intelligence

**Goal**: CVD and order-flow footprint are computed from live trade tape, the backtesting engine runs against the R2 OHLCV archive, Signal Lab persists signals with auto-backtest on save and version history, the options vol surface shows ATM IV curve and skew, and macro confluence (BTC.D, stablecoin supply, Fear & Greed) is live from free/public sources
**Depends on**: Phase 1
**Requirements**: OPTS-03, OPTS-04, CVD-01, CVD-02, CVD-03, CVD-04, BACK-01, BACK-02, BACK-03, BACK-04, SIGLAB-01, SIGLAB-02, SIGLAB-03, SIGLAB-04, SIGLAB-05, MACR-01, MACR-02, MACR-03
**Success Criteria** (what must be TRUE):

1. `/api/v1/cvd/:exchange/:symbol` returns minute/hour CVD bins from live trade tape; order-flow footprint (buy vs sell volume per price level) is available at `/api/v1/footprint/:exchange/:symbol`
2. `/api/v1/backtest` returns equity curve, Sharpe ratio, max drawdown, and win rate sourced from R2; 1-year 1h window completes in under 30 seconds
3. Signal Lab signals survive browser refresh, auto-backtest on save using 365 days of 1h candles, and prior versions are retrievable via `/api/v1/signals/:id/versions`
4. `/api/v1/options/:symbol/surface` returns ATM IV curve across expiries, put/call skew, and wall price levels, refreshed every 5 minutes with a staleness timestamp
5. `/api/v1/macro` returns current BTC.D, stablecoin supply, and Fear & Greed index sourced exclusively from free/public endpoints, refreshed every 15 minutes
   **Plans**: TBD
   **UI hint**: yes

### Phase 5: Accounts + Growth + Hardening

**Goal**: Magic-link and passkey auth is live with server-side session revocation; workspaces, watchlists, alerts, and signals persist to account; any market view is shareable via a short URL with a 1200×630px OG image; the Alpha Feed is Googlebot-indexable with RSS; per-symbol and per-exchange SEO pages are edge-cached; WAU, concurrent WS connections, organic SEO views, and backtest run counts are all instrumented in Analytics Engine
**Depends on**: Phase 3
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, PERS-01, PERS-02, PERS-03, PERS-04, PERS-05, SNAP-01, SNAP-02, SNAP-03, SNAP-04, FEED-01, FEED-02, FEED-03, FEED-04, KPI-03, KPI-04, KPI-05, KPI-06, SEO-01, SEO-02, SEO-03, SEO-04
**Success Criteria** (what must be TRUE):

1. User can register and sign in via magic-link email or passkey (WebAuthn); no password is stored or accepted; sessions persist 30 days; sign-out invalidates the token server-side and it cannot be reused
2. Authenticated user's workspaces, watchlists, alerts, and Signal Lab signals persist across sessions and are restored on login; any saved item can be permanently deleted with HTTP 200 + `deleted: true`
3. Any market view can be shared via a URL-safe slug (≤16 chars) that renders a 1200×630px OG image for social previews; no user PII is embedded in the snapshot
4. Alpha Feed at `/alpha` renders with JSON-LD structured data indexable by Googlebot without JS; `/feed.rss` is valid RSS 2.0; feed updates within 60 seconds of a new signal or liquidation event
5. `/markets/:symbol` and `/exchanges/:exchange` render live data in server-side HTML with canonical tags and `Cache-Control: s-maxage=300`; Googlebot can index them without JS execution
6. WAU, organic SEO page views per URL, concurrent WS connection count (sampled every 60s), and backtest runs per week are written to Analytics Engine and queryable
   **Plans**: TBD
   **UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5
Note: Phase 4 depends on Phase 1 (not Phase 3) — can begin after Phase 3 KPI gate is evaluated.

| Phase                                  | Plans Complete | Status      | Completed |
| -------------------------------------- | -------------- | ----------- | --------- |
| 1. Foundation                          | 0/TBD          | Not started | -         |
| 2. Liquidation Engine + Real-Time Core | 0/TBD          | Not started | -         |
| 3. Alert Delivery + MVP Gate           | 0/TBD          | Not started | -         |
| 4. Derivatives Intelligence            | 0/TBD          | Not started | -         |
| 5. Accounts + Growth + Hardening       | 0/TBD          | Not started | -         |
