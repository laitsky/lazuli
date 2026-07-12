# Requirements: Lazuli

**Defined:** 2026-07-11
**Core Value:** Real-time liquidation alerts delivered to your phone before Coinglass's dashboard refreshes — at zero cost forever.

---

## v1 Requirements

Requirements for the 90-day build. Maps to Phases 1–6.

### Infrastructure (Phase 1 — E-series fixes)

- [ ] **INFRA-01**: `AGENTS.md`, `TODO.md`, and `api-spec.yaml` accurately reflect live code; no documented endpoints or types that don't exist in the deployed Worker
- [ ] **INFRA-02**: `price_alerts` D1 table is wired to an event-bus; CRUD operations succeed via `/api/v1/alerts`; schema migration is additive (no column drops)
- [ ] **INFRA-03**: Binance exchange availability is in a documented, deterministic state — either geo-fenced with a fallback strategy or re-enabled with confirmed access; no silent failures from Binance CCXT calls
- [ ] **INFRA-04**: Backfill window is not capped at 2019–2020; top 50 trading pairs are backfilled to the earliest available exchange history and accessible from R2
- [ ] **INFRA-05**: All secrets (API keys, tokens) are stored via `wrangler secret`; no credentials appear in source code or committed `.env` files

### WebSocket Broker (Phase 1 — A0)

- [ ] **WS-01**: Durable Object WebSocket broker accepts client connections at `/ws`
- [ ] **WS-02**: Broker supports topic-based pub/sub; clients subscribing to `liquidations:BTC` only receive BTC liquidation events, not all events
- [ ] **WS-03**: DO hibernation is used; idle connections do not consume CPU billing
- [ ] **WS-04**: Broker reconnects clients automatically after Durable Object eviction; clients do not need to manually re-subscribe
- [ ] **WS-05**: `/ws` endpoint returns HTTP 101 Switching Protocols on valid upgrade request; returns HTTP 400 on missing `Upgrade: websocket` header

### Liquidation Engine (Phase 2 — A1)

- [ ] **LIQ-01**: Liquidation engine computes cascade-level price thresholds from perp OI, mark price, and leverage distribution for each exchange independently
- [ ] **LIQ-02**: Engine aggregates liquidation levels cross-exchange (Binance, Bybit, OKX, Hyperliquid) into a single normalized output per symbol
- [ ] **LIQ-03**: Liquidation events are published to the WS broker (WS-01) within 800ms p95 of the triggering exchange tick
- [ ] **LIQ-04**: Engine correctly handles missing or stale data from one exchange without dropping events from other exchanges
- [ ] **LIQ-05**: Liquidation events include: symbol, exchange, side (long/short), USD notional, price level, and UTC timestamp

### Public WebSocket Endpoints (Phase 2 — A4)

- [ ] **PUBWS-01**: `GET /ws/tickers` streams real-time best-bid/ask for all tracked symbols across all exchanges
- [ ] **PUBWS-02**: `GET /ws/liquidations` streams live liquidation events in the schema defined by LIQ-05
- [ ] **PUBWS-03**: `GET /ws/orderbook/:exchange/:symbol` streams order-book deltas (bids/asks with size changes, not full snapshots)
- [ ] **PUBWS-04**: `GET /ws/alerts` streams triggered alert events for authenticated subscribers
- [ ] **PUBWS-05**: All public WS endpoints return a valid JSON error frame and close with code 4000 on invalid symbol or unsupported exchange, not a silent disconnect

### Funding Rates & Open Interest (Phase 2 — A5)

- [ ] **FUND-01**: `/api/v1/funding/:symbol` returns OI-weighted funding rate aggregated across all exchanges that list the symbol
- [ ] **FUND-02**: `/api/v1/oi/:symbol` returns open interest per exchange and cross-exchange total for the given symbol
- [ ] **FUND-03**: OI spike radar detects when any symbol's OI increases >10% within a 1-hour rolling window and emits an event to the WS broker
- [ ] **FUND-04**: Funding and OI data refreshes at least every 60 seconds; stale timestamps are surfaced in the API response

### Liquidation Heatmap UI (Phase 2 — A2)

- [ ] **HEAT-01**: Market Workspace page renders a liquidation heatmap overlay showing price levels with the highest cascade liquidation notional
- [ ] **HEAT-02**: Heatmap color intensity is proportional to USD notional at each price level; scale is labeled in the UI
- [ ] **HEAT-03**: Heatmap updates in real-time via the WS liquidation stream; user does not need to refresh the page to see new data
- [ ] **HEAT-04**: Heatmap supports toggling individual exchanges on/off to isolate per-exchange liquidation depth

### Push Alert Delivery (Phase 3 — A3)

- [ ] **ALRT-01**: User can create a liquidation alert specifying: symbol, notional threshold (USD), side (long/short/both), and delivery channel
- [ ] **ALRT-02**: Alerts are delivered via Telegram when a configured bot token and chat ID are provided
- [ ] **ALRT-03**: Alerts are delivered via Discord when a configured webhook URL is provided
- [ ] **ALRT-04**: Alerts are delivered via HTTP Webhook when a user-supplied HTTPS URL is provided; payload is JSON matching the liquidation event schema
- [ ] **ALRT-05**: Alerts are delivered via email when a valid email address is provided
- [ ] **ALRT-06**: Alert delivery is attempted within 800ms p95 of the liquidation event timestamp
- [ ] **ALRT-07**: Failed deliveries are retried at least once after 30 seconds; permanent failures are marked in D1 with an error reason
- [ ] **ALRT-08**: User can list, update, and delete their alert subscriptions via `/api/v1/alerts`

### Options Greeks (Phase 1 / Phase 4 — E3 / B4)

- [ ] **OPTS-01**: `/api/v1/options/:symbol/greeks` returns delta, gamma, vega, and theta for each listed options contract; no field returns `null` for contracts where Deribit IV is available
- [ ] **OPTS-02**: Greeks are computed via Black-Scholes using Deribit-provided implied volatility as the vol input
- [ ] **OPTS-03**: `/api/v1/options/:symbol/surface` returns ATM IV curve across expiries (term structure), put/call skew at each expiry, and put/call wall price levels
- [ ] **OPTS-04**: Vol surface data is refreshed at least every 5 minutes; staleness timestamp is included in the response

### CVD / Order Flow (Phase 4 — B1)

- [ ] **CVD-01**: `/api/v1/cvd/:exchange/:symbol` returns cumulative volume delta computed from the trade-tape WebSocket stream, binned by minute and hour
- [ ] **CVD-02**: CVD resets at midnight UTC; historical bins for the current day are available without page reload
- [ ] **CVD-03**: Order-flow footprint data (buy volume vs sell volume per price level) is available via `/api/v1/footprint/:exchange/:symbol`
- [ ] **CVD-04**: CVD stream is published to the WS broker so front-end clients receive updates without polling

### Backtesting Engine (Phase 4 — B2)

- [ ] **BACK-01**: `/api/v1/backtest` accepts a signal definition (entry/exit conditions as structured JSON), symbol, and date range; returns equity curve, Sharpe ratio, max drawdown, and win rate
- [ ] **BACK-02**: Backtest data is sourced from the R2 OHLCV archive; results are reproducible given the same input parameters
- [ ] **BACK-03**: Backtest endpoint returns a 400 error with a human-readable message if the requested date range has no R2 data for the symbol
- [ ] **BACK-04**: Backtest runs complete within 30 seconds for a 1-year window on 1-hour candles; longer windows return a job ID for async retrieval

### Signal Lab (Phase 4 — B3)

- [ ] **SIGLAB-01**: Authenticated user can create a named signal with entry/exit conditions via `POST /api/v1/signals`
- [ ] **SIGLAB-02**: Signal auto-backtests on save using the last 365 days of 1-hour candles for the configured symbol; results are stored server-side and returned in the save response
- [ ] **SIGLAB-03**: Signal definition and latest backtest results survive browser refresh; retrievable via `GET /api/v1/signals/:id`
- [ ] **SIGLAB-04**: Signal versions are tracked; user can retrieve prior versions via `GET /api/v1/signals/:id/versions`
- [ ] **SIGLAB-05**: User can list all their signals via `GET /api/v1/signals`; list returns signal name, last-modified date, and latest Sharpe ratio

### Macro Confluence (Phase 4 — B5)

- [ ] **MACR-01**: `/api/v1/macro` returns current BTC dominance (BTC.D), total stablecoin supply, and Fear & Greed index value with source timestamps
- [ ] **MACR-02**: All macro data is sourced from free/public endpoints (CoinGecko Fear & Greed, on-chain public APIs); no paid provider dependency
- [ ] **MACR-03**: Macro data refreshes at least every 15 minutes; cached value is served between refreshes with a `stale: true` flag if the upstream fetch fails

### Authentication & Accounts (Phase 5 — D1)

- [ ] **AUTH-01**: User can register and sign in via magic-link email; no password is stored or accepted
- [ ] **AUTH-02**: User can register and sign in via passkey (WebAuthn); credential is stored in D1 without any plaintext secret
- [ ] **AUTH-03**: Magic-link tokens expire after 15 minutes; expired tokens return HTTP 401
- [ ] **AUTH-04**: User session (JWT or D1-backed session token) persists across browser refresh for at least 30 days without re-authentication
- [ ] **AUTH-05**: Session is invalidated server-side on explicit sign-out; the token cannot be reused after logout
- [ ] **AUTH-06**: No PII (email, IP) is written to Cloudflare Workers logs or Analytics Engine event fields

### Saved Workspaces & Persistence (Phase 5 — D2)

- [ ] **PERS-01**: Authenticated user can save a named workspace (layout, selected symbols, active overlays) via `POST /api/v1/workspaces`
- [ ] **PERS-02**: Authenticated user can save a watchlist of up to 50 symbols; watchlist persists across sessions
- [ ] **PERS-03**: Saved alerts (ALRT-01) are linked to the user's account and restored on next login
- [ ] **PERS-04**: Saved backtests and Signal Lab signals (SIGLAB-01) are linked to the user's account
- [ ] **PERS-05**: User can delete any saved item (workspace, watchlist, alert, signal); deletion is permanent and confirmed with HTTP 200 + `deleted: true`

### Shareable Snapshots (Phase 5 — D3)

- [ ] **SNAP-01**: `GET /share/:snapshotId` renders a static HTML page with an OG image of the snapshot for social sharing
- [ ] **SNAP-02**: OG image is generated via the existing `lib/screenshot.ts` infrastructure; image dimensions are 1200×630px
- [ ] **SNAP-03**: Snapshot URL is generated by `POST /api/v1/snapshots` and returns a short slug; slug is URL-safe and ≤16 characters
- [ ] **SNAP-04**: Snapshots are publicly accessible without authentication; no user PII is embedded in the snapshot or OG image

### Alpha Feed (Phase 5 — D4)

- [ ] **FEED-01**: `GET /api/v1/alpha` returns the top 20 triggered signals and liquidation alerts from the last 24 hours, sorted by notional impact descending
- [ ] **FEED-02**: `GET /feed.rss` returns the same Alpha Feed as a valid RSS 2.0 document; each item has a title, description, pubDate, and link
- [ ] **FEED-03**: Alpha Feed HTML page at `/alpha` is edge-rendered with semantic HTML and structured data (JSON-LD); Googlebot can index it without JavaScript execution
- [ ] **FEED-04**: Alpha Feed is updated within 60 seconds of a new signal or liquidation event being triggered

### KPI Instrumentation (Phase 3 — non-optional)

- [ ] **KPI-01**: Push-alert subscriber count is written to Cloudflare Analytics Engine on every subscribe/unsubscribe event; count is queryable
- [ ] **KPI-02**: Liquidation-feed end-to-end p95 latency (exchange tick → WS client receipt) is measured and written to Analytics Engine; p95 is queryable
- [ ] **KPI-03**: Organic SEO landing page views are written to Analytics Engine per URL; total monthly unique views are queryable
- [ ] **KPI-04**: WAU (weekly active users, defined as unique session tokens making ≥1 API or WS request in a 7-day window) is written to Analytics Engine
- [ ] **KPI-05**: Concurrent WS connections count is sampled every 60 seconds and written to Analytics Engine
- [ ] **KPI-06**: Backtest runs per week are counted and written to Analytics Engine on each `/api/v1/backtest` call

### Error Handling & Observability (table stakes)

- [ ] **ERR-01**: All `/api/v1/` endpoints return JSON in the format `{ success, data, error, timestamp }`; no endpoint returns a non-JSON body on error
- [ ] **ERR-02**: HTTP 5xx errors include a `requestId` field in the response body; the same `requestId` appears in Worker logs for correlation
- [ ] **ERR-03**: Exchange API failures (rate limit, timeout, geo-block) are caught and surfaced as HTTP 503 with `error.code: "EXCHANGE_UNAVAILABLE"` and the exchange name; they do not propagate as unhandled exceptions
- [ ] **ERR-04**: D1 query failures do not crash the Worker; the handler returns HTTP 503 with `error.code: "DB_UNAVAILABLE"` and continues serving cached/live data where possible
- [ ] **ERR-05**: Input validation errors return HTTP 400 with a `fields` array describing each invalid parameter by name and reason
- [ ] **ERR-06**: `/health` endpoint returns HTTP 200 with status of D1, R2, Queue, Durable Object, and Analytics Engine bindings; returns HTTP 503 if any binding is unreachable

### SEO Infrastructure (Phase 5 — D6)

- [ ] **SEO-01**: `GET /markets/:symbol` renders an edge-rendered, statically cached HTML page for each tracked symbol with current price, liquidation depth, and funding rate in the page body (not JS-rendered)
- [ ] **SEO-02**: `GET /exchanges/:exchange` renders a similar page for each supported exchange listing its top symbols and recent liquidation activity
- [ ] **SEO-03**: All SEO pages include canonical `<link>`, `<title>`, `<meta name="description">`, and Open Graph tags
- [ ] **SEO-04**: SEO pages are served with `Cache-Control: s-maxage=300` (5-minute edge cache); stale-while-revalidate is set

---

## v2 Requirements

Deferred until post-90-day PMF validation.

### API Key Issuance (D5)

- **APIKEY-01**: Authenticated user can generate an API key via the dashboard; key is displayed once and not stored in plaintext
- **APIKEY-02**: API key authenticates requests to `/api/v1/` as an alternative to session token
- **APIKEY-03**: API key can be revoked by the user; revoked keys return HTTP 401 immediately
- **APIKEY-04**: Public API documentation is available at `/docs` describing all v1 endpoints, parameters, and response schemas

### Screener (C1)

- **SCRN-01**: `/api/v1/screener` accepts filter params for RSI range, funding rate range, OI delta threshold, and volume breakout ratio; returns matching symbols
- **SCRN-02**: Screener results are sortable by any filter dimension
- **SCRN-03**: Screener state (filters, sort) can be bookmarked and shared via URL params without authentication

### Funding Arbitrage (C2)

- **FARB-01**: `/api/v1/funding/arbitrage` returns basis-curve history (spot-perp spread over time) for the top 20 pairs
- **FARB-02**: Yield calculation deducts estimated taker fees for each exchange before returning net annualized yield
- **FARB-03**: Pairs are ranked by net annualized yield descending

### Trending / Volume-Spike Detector (C4)

- **TREND-01**: `/api/v1/trending` returns symbols where 24h volume exceeds 7-day average volume by ≥2×, sorted by ratio descending
- **TREND-02**: Trending feed updates every 15 minutes

### Monetization (post-90d)

- **MON-01**: Pro tier feature flags are gated by a D1 `account_tier` field; no Stripe integration required for flag evaluation
- **MON-02**: Rate limiting is enforced per API key at the Worker level before any pro tier is introduced

---

## Out of Scope

| Feature                                               | Reason                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Password-based authentication                         | Password storage is a liability; magic-link + passkey eliminates credential stuffing attack surface entirely                                     |
| Native iOS / Android app                              | App Store review delays and separate release track; Telegram/Discord push + mobile-responsive web delivers the same value                        |
| Self-hosted / bring-your-own-cloud deployment         | Durable Objects and R2 are load-bearing primitives; abstracting them doubles architecture surface area with no user benefit in the 90-day window |
| Paid or proprietary data providers                    | Zero data licensing budget; all exchanges (Binance, Bybit, OKX, Hyperliquid, Deribit) and macro sources (CoinGecko) are free/public              |
| Destructive D1 migrations (DROP COLUMN, RENAME TABLE) | Running Workers must not break mid-deploy; rollback is via code revert, not down-migration                                                       |
| Backfilling all exchange pairs                        | Saturates Cloudflare Queue budget; top-50 pairs cover 95%+ of backtest demand                                                                    |
| Social sentiment (Twitter / Reddit)                   | Twitter API costs $100+/mo; scraping is ToS-risky; Fear & Greed index covers macro sentiment adequately                                          |
| Copy trading / trade execution                        | Requires brokerage licensing and exchange API key management; out of scope for an intelligence platform                                          |
| Stochastic options models (SABR, Heston)              | Black-Scholes from Deribit IV is accurate enough for retail; revisit only after B4 validates institutional options demand                        |
| Monetization / paywalls before Week 10                | Paywall before PMF kills the growth flywheel; 5,000 alert subscribers and 50k/mo organic landings are more valuable than early revenue           |
| Breaking changes to `/api/v1/` contracts              | Shipped endpoints are frozen; new behavior goes on new paths or optional fields only                                                             |

---

## Traceability

| Requirement | Phase        | Status  |
| ----------- | ------------ | ------- |
| INFRA-01    | Phase 1 (E1) | Pending |
| INFRA-02    | Phase 1 (E2) | Pending |
| INFRA-03    | Phase 1 (E5) | Pending |
| INFRA-04    | Phase 1 (E4) | Pending |
| INFRA-05    | Phase 1      | Pending |
| WS-01       | Phase 1 (A0) | Pending |
| WS-02       | Phase 1 (A0) | Pending |
| WS-03       | Phase 1 (A0) | Pending |
| WS-04       | Phase 1 (A0) | Pending |
| WS-05       | Phase 1 (A0) | Pending |
| ERR-01      | Phase 1      | Pending |
| ERR-02      | Phase 1      | Pending |
| ERR-03      | Phase 1      | Pending |
| ERR-04      | Phase 1      | Pending |
| ERR-05      | Phase 1      | Pending |
| ERR-06      | Phase 1      | Pending |
| OPTS-01     | Phase 1 (E3) | Pending |
| OPTS-02     | Phase 1 (E3) | Pending |
| LIQ-01      | Phase 2 (A1) | Pending |
| LIQ-02      | Phase 2 (A1) | Pending |
| LIQ-03      | Phase 2 (A1) | Pending |
| LIQ-04      | Phase 2 (A1) | Pending |
| LIQ-05      | Phase 2 (A1) | Pending |
| PUBWS-01    | Phase 2 (A4) | Pending |
| PUBWS-02    | Phase 2 (A4) | Pending |
| PUBWS-03    | Phase 2 (A4) | Pending |
| PUBWS-04    | Phase 2 (A4) | Pending |
| PUBWS-05    | Phase 2 (A4) | Pending |
| FUND-01     | Phase 2 (A5) | Pending |
| FUND-02     | Phase 2 (A5) | Pending |
| FUND-03     | Phase 2 (A5) | Pending |
| FUND-04     | Phase 2 (A5) | Pending |
| HEAT-01     | Phase 2 (A2) | Pending |
| HEAT-02     | Phase 2 (A2) | Pending |
| HEAT-03     | Phase 2 (A2) | Pending |
| HEAT-04     | Phase 2 (A2) | Pending |
| ALRT-01     | Phase 3 (A3) | Pending |
| ALRT-02     | Phase 3 (A3) | Pending |
| ALRT-03     | Phase 3 (A3) | Pending |
| ALRT-04     | Phase 3 (A3) | Pending |
| ALRT-05     | Phase 3 (A3) | Pending |
| ALRT-06     | Phase 3 (A3) | Pending |
| ALRT-07     | Phase 3 (A3) | Pending |
| ALRT-08     | Phase 3 (A3) | Pending |
| KPI-01      | Phase 3      | Pending |
| KPI-02      | Phase 3      | Pending |
| OPTS-03     | Phase 4 (B4) | Pending |
| OPTS-04     | Phase 4 (B4) | Pending |
| CVD-01      | Phase 4 (B1) | Pending |
| CVD-02      | Phase 4 (B1) | Pending |
| CVD-03      | Phase 4 (B1) | Pending |
| CVD-04      | Phase 4 (B1) | Pending |
| BACK-01     | Phase 4 (B2) | Pending |
| BACK-02     | Phase 4 (B2) | Pending |
| BACK-03     | Phase 4 (B2) | Pending |
| BACK-04     | Phase 4 (B2) | Pending |
| SIGLAB-01   | Phase 4 (B3) | Pending |
| SIGLAB-02   | Phase 4 (B3) | Pending |
| SIGLAB-03   | Phase 4 (B3) | Pending |
| SIGLAB-04   | Phase 4 (B3) | Pending |
| SIGLAB-05   | Phase 4 (B3) | Pending |
| MACR-01     | Phase 4 (B5) | Pending |
| MACR-02     | Phase 4 (B5) | Pending |
| MACR-03     | Phase 4 (B5) | Pending |
| AUTH-01     | Phase 5 (D1) | Pending |
| AUTH-02     | Phase 5 (D1) | Pending |
| AUTH-03     | Phase 5 (D1) | Pending |
| AUTH-04     | Phase 5 (D1) | Pending |
| AUTH-05     | Phase 5 (D1) | Pending |
| AUTH-06     | Phase 5 (D1) | Pending |
| PERS-01     | Phase 5 (D2) | Pending |
| PERS-02     | Phase 5 (D2) | Pending |
| PERS-03     | Phase 5 (D2) | Pending |
| PERS-04     | Phase 5 (D2) | Pending |
| PERS-05     | Phase 5 (D2) | Pending |
| SNAP-01     | Phase 5 (D3) | Pending |
| SNAP-02     | Phase 5 (D3) | Pending |
| SNAP-03     | Phase 5 (D3) | Pending |
| SNAP-04     | Phase 5 (D3) | Pending |
| FEED-01     | Phase 5 (D4) | Pending |
| FEED-02     | Phase 5 (D4) | Pending |
| FEED-03     | Phase 5 (D4) | Pending |
| FEED-04     | Phase 5 (D4) | Pending |
| KPI-03      | Phase 5      | Pending |
| KPI-04      | Phase 5      | Pending |
| SEO-01      | Phase 5 (D6) | Pending |
| SEO-02      | Phase 5 (D6) | Pending |
| SEO-03      | Phase 5 (D6) | Pending |
| SEO-04      | Phase 5 (D6) | Pending |
| KPI-05      | Phase 6      | Pending |
| KPI-06      | Phase 6      | Pending |

**Coverage:**

- v1 requirements: 87 total
- Mapped to phases: 87
- Unmapped: 0 ✓

---

_Requirements defined: 2026-07-11_
_Last updated: 2026-07-11 after initial definition from PROJECT.md and feature research_
