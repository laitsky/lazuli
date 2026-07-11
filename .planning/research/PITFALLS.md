# Pitfalls Research

**Domain:** Edge-native crypto market intelligence platform (real-time liquidations, derivatives analytics, push alerts)
**Researched:** 2026-07-11
**Confidence:** HIGH (Cloudflare platform constraints), MEDIUM (crypto exchange API behavior), HIGH (existing project debt identified in PROJECT.md)

---

## Critical Pitfalls

### Pitfall 1: Durable Object Hibernation Evicts In-Memory State

**What goes wrong:**
A Durable Object's in-memory state (subscriber maps, connection maps, cached tick data) is silently dropped when the DO hibernates due to inactivity. On next wake, the DO has no knowledge of previous WebSocket clients. Clients stay connected at the TCP level but receive no messages. The bug appears as "working in tests, silent in prod after 30 seconds of low traffic."

**Why it happens:**
Developers correctly set up WebSocket connections inside a DO but store subscriber state as instance properties (`this.subscribers = new Map()`). Cloudflare hibernates DOs to save cost. On wake, the constructor re-runs but the Map is empty. The DO re-accepts hibernated connections via `webSocketMessage()` but has no routing table to send messages to them.

**How to avoid:**

- Use `ctx.acceptWebSocket(ws)` (hibernation API) instead of raw `ws` handling — this re-attaches connections after wake
- Store all durable state (subscription topics, alert configs) in DO's `storage` not in-memory Maps
- Reconstruct in-memory routing tables from storage in the `initialize()` / alarm handler on wake
- Never assume `this.*` survives across requests in a DO

**Warning signs:**

- WebSocket clients connect successfully but stop receiving messages after a traffic lull
- DO logs show repeated `constructor` calls with empty state
- Alert fanout silently drops to zero during off-hours

**Phase to address:** Phase 1 / A0 (WebSocket broker foundation) — get this right before A1/A4 build on top of it

---

### Pitfall 2: D1 Additive-Only Migration Debt Compounds Into Schema Rot

**What goes wrong:**
Each phase adds columns with `ALTER TABLE ADD COLUMN ... DEFAULT NULL`. Within 6 months, core tables have 30+ nullable columns, half of which are never populated on old rows. Queries silently return stale nulls instead of errors. New agents reading the schema can't distinguish "feature not yet backfilled" from "feature doesn't exist for this row."

**Why it happens:**
The additive-only constraint (correct for zero-downtime deploys) is followed mechanically without a companion discipline for deprecation markers or column-level documentation. `price_alerts` already exists unwired — the pattern of adding schema without wiring it is established and will repeat.

**How to avoid:**

- Every `ALTER TABLE ADD COLUMN` must come with a companion migration comment: `-- added: 2026-07-XX, wired: <item_id>, backfill: yes/no`
- Use `CHECK` constraints where possible to encode valid states at DB level
- After a column is wired, immediately backfill existing rows or set a sentinel value (not NULL) to distinguish "legacy empty" from "current empty"
- Treat schema changes as part of the same PR as the feature that uses them — never add columns speculatively

**Warning signs:**

- More than 5 nullable columns on any table without explicit backfill tracking
- SELECT queries returning unexpected nulls in production that pass in dev (where DB is freshly seeded)
- E1/E2/E3 items revealing existing "dead" schema (already happening with `price_alerts`)

**Phase to address:** Phase 1 / E2 (wire `price_alerts`) — establish the migration discipline now before every phase adds schema

---

### Pitfall 3: Exchange Rate Limits Silently Collapse Backfill Queues

**What goes wrong:**
The backfill job (E4) fans out requests across 50 pairs × multiple exchanges. Each exchange silently throttles after ~10-20 req/min on the public REST API. Cloudflare Queue consumers retry on failure, but with default exponential backoff the queue fills faster than it drains. D1 job records show "in_progress" forever. Workers bill for CPU on failed retries. Actual backfill completes in weeks instead of days — or never.

**Why it happens:**
CCXT's `rateLimit` config is set per-exchange and defaults to a conservative global value. When you fan out via Queues, the per-exchange rate limit applies per Worker invocation, not globally. Multiple Queue consumers run in parallel, each unaware of what other consumers are fetching from the same exchange endpoint.

**How to avoid:**

- Use a single rate-limiter Durable Object per exchange as a token bucket — Queue consumers must acquire a token before calling the exchange
- Set `maxConcurrency` on Queue consumers to 1 per exchange to avoid parallel hammering
- Store exchange rate limit state (remaining calls, reset timestamp) in the rate-limiter DO, not in Worker memory
- Add dead-letter handling: after 3 retries, write a failure record to D1 and move on — don't let one bad pair stall the queue

**Warning signs:**

- D1 backfill job records stuck in `in_progress` for > 30 minutes
- Worker invocation logs showing 429 responses from exchanges
- Queue depth growing instead of shrinking during backfill

**Phase to address:** Phase 1 / E4 (backfill) — needs rate-limiter DO before queue fan-out starts

---

### Pitfall 4: Liquidation Math Built on Stale OI Gives Wrong Cascade Levels

**What goes wrong:**
The liquidation engine (A1) computes cascade levels from OI + mark price + leverage. If OI data is polled every 30s but mark price is polled every 5s, the cascade calculation uses a mismatched snapshot. During high-volatility events (exactly when liquidation data matters most), OI can move 10-20% between polls. The displayed liquidation wall is wrong by the same margin — traders act on bad data.

**Why it happens:**
Engineers poll OI and mark price on separate schedules because they come from different exchange endpoints with different rate limits. The liquidation formula is correct in isolation but assumes temporal coherence between inputs it doesn't have.

**How to avoid:**

- Fetch OI and mark price in the same request batch, or timestamp each input and refuse to compute if inputs are > N seconds apart
- For the A1 liquidation engine: treat the computation as a streaming pipeline where all inputs are from the same exchange WebSocket feed (not REST polls) — this gives inherent temporal coherence
- Document the staleness tolerance for each calculation in the code — `// max_input_age_ms: 5000` as a constant, not implicit

**Warning signs:**

- Liquidation level estimates drifting noticeably from competitor values during volatile periods
- OI poll interval and mark price poll interval set to different values in config
- Cascade levels calculated using data from different Worker invocations (different timestamps)

**Phase to address:** Phase 2 / A1 (liquidation engine) — design the data pipeline before writing the math

---

### Pitfall 5: Binance Geo-Block Left Unresolved Poisons Every Downstream Feature

**What goes wrong:**
Binance is the largest perp market by OI. If E5 doesn't definitively resolve the geo-block (either proxied via Workers route rules, or formally excluded from all calculations), every downstream feature silently produces wrong results. Liquidation walls missing Binance are wrong. OI-weighted funding rates excluding Binance are wrong. The product launches claiming "cross-exchange data" but quietly excludes the biggest exchange.

**Why it happens:**
The geo-block is an uncomfortable unknown — resolving it requires either a technical workaround (Workers deployed in non-geo-blocked region) or a product decision (exclude Binance and say so). Teams defer uncomfortable decisions that require coordination. The current state ("undefined") means every new feature makes an implicit assumption about Binance availability.

**How to avoid:**

- E5 must produce a binary outcome: either Binance works and is in all calculations, or Binance is excluded and every UI element that aggregates across exchanges says so explicitly
- Never write code that optionally includes Binance — `if (binanceAvailable)` scattered across the codebase means two code paths to maintain and test
- If using Workers' ability to route traffic through specific regions to bypass geo-blocking: document the wrangler route config explicitly and add a health check that verifies Binance connectivity from the deployed Worker region

**Warning signs:**

- Any feature merged after Wk1 that calls Binance endpoints without first checking E5's resolution
- `if (exchange === 'binance')` conditionals appearing in A1, A5, or B1 code
- Competitor comparisons showing Lazuli missing Binance perp OI

**Phase to address:** Phase 1 / E5 — this is a blocker that must be resolved before any Phase 2 calculation feature

---

### Pitfall 6: Durable Object Fan-Out to Thousands of WebSocket Clients Hits CPU Limits

**What goes wrong:**
A single Durable Object broadcasting liquidation alerts to 2,000 concurrent WebSocket connections hits Cloudflare's 30-second CPU limit per invocation. Each `ws.send()` call is fast, but iterating 2,000 connections with JSON serialization per message exceeds the limit during high-frequency events (e.g., a BTC flash crash generating 50 messages/second).

**Why it happens:**
The naive architecture puts all subscribers on one DO instance. This works fine in testing with 10 connections and fails silently at scale — the DO starts dropping messages without surfacing errors to clients.

**How to avoid:**

- Shard the subscriber DO by topic prefix: one DO per symbol or per exchange, not one DO for all subscribers
- Use a hub-and-spoke model: a single "router" DO that forwards to per-symbol subscriber DOs; clients subscribe to the symbol DO, not the router
- Benchmark DO fanout at target scale (2,000 connections) in a staging environment before Phase 3 alert delivery goes live
- Use `waitUntil()` for non-critical fan-out to avoid blocking the main request path

**Warning signs:**

- DO CPU warnings appearing in Cloudflare dashboard during high-traffic events
- Clients reporting delayed or dropped messages during volatile market periods
- A0 performance testing showing message latency spikes above 800ms threshold

**Phase to address:** Phase 1 / A0 (WebSocket broker design) and Phase 2 / A4 (public WS endpoints)

---

### Pitfall 7: Black-Scholes Greeks Computed Without IV Surface Interpolation Gives Nonsense at Extremes

**What goes wrong:**
Deribit provides IV for specific strikes and expiries. For strikes/expiries not directly in Deribit's data, the simplest implementation uses the nearest available IV — which can be wildly wrong for deep OTM options or near-expiry contracts. B4's vol surface visualization shows correct-looking charts for ATM options but nonsense for wing strikes.

**Why it happens:**
The E3 implementation correctly does Black-Scholes given IV, but IV sourcing is treated as "just fetch from Deribit." The subtlety is that Deribit provides a discrete grid; real vol surfaces require interpolation (typically cubic spline or SVI parametrization) between grid points.

**How to avoid:**

- For E3 (MVP Greeks): explicitly document which strikes/expiries are directly sourced vs. interpolated, and show UI warning for interpolated values
- For B4 (vol surface): implement linear interpolation along strike axis as minimum — document this is linear, not cubic, so traders know accuracy limits
- Never display a Greek without showing the IV that generated it — allows traders to sanity-check the input
- Test with Deribit's BTC-PERPETUAL and ETH-PERPETUAL which have dense strike grids, not illiquid alts

**Warning signs:**

- Delta values outside [0,1] for calls or [-1,0] for puts
- Vega displaying as zero for near-ATM options (usually means IV was fetched as null and defaulted to 0)
- Greeks suddenly changing discontinuously when an expiry rolls off Deribit's book

**Phase to address:** Phase 1 / E3 (Greeks implementation) with validation gate before B4 vol surface

---

### Pitfall 8: Magic-Link Auth Without Session Revocation Creates Ghost Sessions

**What goes wrong:**
Magic-link auth (D1) issues JWT or session tokens. If a user loses their device or suspects account compromise, there's no revocation mechanism — the token stays valid until natural expiry. For a crypto trading tool where users save alert configs and API keys, this is a meaningful security gap.

**Why it happens:**
Magic-link auth is simpler than password auth (no bcrypt infra) but the session management complexity doesn't go away — it shifts to revocation and refresh token handling. Teams shipping quickly implement the happy path (issue token, verify token) without the revocation path.

**How to avoid:**

- Store session tokens in D1 with a `revoked_at` column; every auth middleware check must query D1 (use DO cache to avoid per-request D1 hits)
- Implement `/auth/logout` that writes `revoked_at` immediately
- Set magic-link token TTL to 15 minutes (time-limited, one-use) and session token TTL to 7 days (with sliding renewal)
- For API keys (D5): separate key table with explicit `revoked_at` and `last_used_at` — users must be able to rotate keys

**Warning signs:**

- Auth implementation that only validates JWT signature without checking revocation list
- No `/auth/logout` endpoint in the API spec
- D1 auth tables missing `revoked_at` column

**Phase to address:** Phase 5 / D1 (accounts + auth) — build revocation into the schema from day one

---

## Technical Debt Patterns

| Shortcut                                              | Immediate Benefit                              | Long-term Cost                                                                        | When Acceptable                                                                    |
| ----------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Poll REST instead of WebSocket for exchange data      | Simpler to implement, no connection management | Adds 500ms–5s latency vs. stream; misses your core latency moat                       | Never for liquidation/mark price data; OK for daily stats like funding history     |
| Single DO for all WebSocket subscribers               | No sharding logic to write                     | Hits CPU limits at ~500 concurrent connections; message drops at scale                | Only in Phase 1 for A0 prototype; must shard before Phase 3 production             |
| NULL Greeks in database until E3 is done              | Unblocks other DB work                         | Silent wrong answers if any feature reads Greeks before E3 ships                      | Never — add a `CHECK (greeks_computed = 0 OR greeks_delta IS NOT NULL)` constraint |
| Hardcode top-50 pair list                             | No discovery logic needed                      | Stale list misses newly-listed pairs; misses sudden OI concentration in unlisted pair | Acceptable for 90-day scope; flag pairs for manual review monthly                  |
| Skip DO CPU benchmark until Phase 3                   | Faster to ship A0                              | Discovery that A0 can't handle prod load arrives after A1/A4 are built on top of it   | Never — benchmark at realistic concurrency before declaring A0 complete            |
| Store Cloudflare secrets in `.dev.vars` for local dev | Easy local development                         | Developers accidentally commit `.dev.vars` or ship with dev secrets                   | Acceptable for local-only `.dev.vars` with `.gitignore` entry verified             |

---

## Integration Gotchas

| Integration                 | Common Mistake                                                                           | Correct Approach                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| CCXT + Cloudflare Workers   | Import full CCXT bundle (3MB+); Workers have 1MB script size limit                       | Use CCXT's exchange-specific sub-packages or tree-shake; alternatively call exchange REST directly for hot paths         |
| Deribit WebSocket           | Subscribe once, assume persistent; exchange closes idle connections after ~60s           | Implement ping/pong keepalive on 30s interval; reconnect on close with exponential backoff                               |
| Binance Futures REST (geo)  | Call from default Workers deployment region; 451 response silently treated as empty data | Explicitly check response status; log 451 as an exchange availability event, not a data event                            |
| Cloudflare D1 from DO       | Call D1 on every WebSocket message for subscription lookup                               | Cache subscription state in DO memory/storage; only sync to D1 on subscription change                                    |
| R2 for OHLCV archives       | Write one object per candle                                                              | Write batched Parquet-style objects (1 object per day per pair); per-candle objects hit R2 list limits and inflate costs |
| Cloudflare Analytics Engine | Write events synchronously in request path                                               | Use `ctx.waitUntil()` to write analytics events non-blocking — never block user response for instrumentation             |
| Telegram Bot API for alerts | Call Telegram synchronously in the alert delivery path                                   | Fan-out alert delivery via Queue; Telegram API has its own rate limits and can time out                                  |
| CoinGecko Fear & Greed (B5) | Assume endpoint stability; it has moved/changed format twice                             | Pin to versioned endpoint; add response schema validation with graceful degradation if schema changes                    |

---

## Performance Traps

| Trap                                               | Symptoms                                                                                | Prevention                                                                                                                   | When It Breaks                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Per-message D1 query for auth in WebSocket handler | WS message latency climbs to 50–200ms; D1 query shows up as top CPU consumer            | Cache session validity in DO storage for WS connections; re-validate on reconnect only                                       | At ~100 concurrent authenticated WS connections                           |
| Synchronous R2 read in liquidation calculation     | P95 latency spikes above 800ms SLO during market events when R2 has higher tail latency | Preload required R2 objects into DO cache at connection time; serve from cache during calculation                            | At any traffic level — R2 tail latency is unpredictable                   |
| Unbounded OHLCV query for backtest (B2)            | Backtest for 2 years of daily candles on 50 pairs loads 36,500 R2 objects               | Implement R2 object layout as monthly partitions (1 object per symbol per month); query by date range not individual candles | From day one of B2 if candle layout is per-candle                         |
| CVD computation scanning full trade tape           | B1 CVD growing to gigabytes in DO storage as trade tape accumulates                     | Compute incremental CVD delta per trade event, store only the running total; never store raw tape in DO                      | DO storage limit is 128MB; hits limit within hours of high-volume trading |
| OG image generation on request (D3)                | Screenshot endpoint times out under load; Workers have 30s CPU limit                    | Pre-generate OG images on snapshot save via Queue; serve from R2/KV cache                                                    | At ~10 concurrent snapshot requests                                       |

---

## Security Mistakes

| Mistake                                                                      | Risk                                                                                   | Prevention                                                                                                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API keys stored in D1 as plaintext                                           | Database read = full key compromise; keys can call exchange APIs on user's behalf      | Store only HMAC-SHA256 hash of key in D1; never store raw key after issuance; user only sees key at creation time                                          |
| WebSocket connections not authenticated before receiving alert subscriptions | Unauthenticated clients can subscribe to any user's private alerts                     | Require auth token in WS upgrade request headers or first message; reject unauthenticated WS connections immediately                                       |
| Logging exchange API responses that include user IP or order data            | PII logging violates stated constraint; Cloudflare log exports can be accessed by team | Strip all user-identifying fields before logging; log exchange response status codes only, not response bodies                                             |
| SSRF via webhook alert destination (A3)                                      | User sets webhook URL to internal Cloudflare metadata endpoint or internal DO URL      | Validate webhook URLs against allowlist of schemes (https only) and deny RFC-1918 + link-local address ranges                                              |
| Magic-link tokens in URL query params                                        | Tokens logged in server access logs, browser history, referrer headers                 | Send magic-link token in URL fragment (#token=...) which is never sent to server, or as a short-lived redirect with token consumed server-side immediately |
| Shareable snapshot URLs expose private alert configs (D3)                    | Snapshot of a workspace with private alerts leaks alert thresholds                     | Snapshots must be explicitly scoped to public data only; strip account-linked alert configs before serializing snapshot                                    |

---

## UX Pitfalls

| Pitfall                                                              | User Impact                                                                                | Better Approach                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Showing "loading..." for liquidation data with no fallback timestamp | Trader doesn't know if data is 1s stale or 60s stale; can't trust it                       | Always display data freshness timestamp next to every live metric; show "last updated Xs ago" not just a spinner               |
| Alert triggered but no confirmation shown in UI                      | User doesn't know if alert fired; re-subscribes multiple times; alert fires multiple times | Show alert event log in UI; deduplicate alerts with idempotency key; display "Alert fired at HH:MM:SS" in history              |
| Vol surface (B4) rendered with no explanation of axes                | Retail traders unfamiliar with IV surface lose trust in the data                           | Add inline glossary tooltip: "IV surface shows implied volatility (y-axis) vs. strike as % of spot (x-axis) for each expiry"   |
| Backtest equity curve without drawdown overlay (B2)                  | Traders misread a volatile but profitable strategy as safe                                 | Always co-render max drawdown shading on equity curve; show Sharpe ratio prominently                                           |
| Real-time feed pauses during reconnect with no indicator             | UI looks frozen; trader thinks data is current when it's stale                             | Show reconnection state clearly: "Reconnecting... (last data 12s ago)" with countdown                                          |
| SEO landing pages with no live data preview (D6)                     | Organic landing visitor sees a static page with no reason to stay                          | Embed a lightweight live ticker widget on every SEO page; give visitors a taste of real-time before requiring account creation |

---

## "Looks Done But Isn't" Checklist

- [ ] **A0 WebSocket Broker:** Often missing DO hibernation reconnection — verify that clients re-receive messages after a 60-second traffic lull without reconnecting
- [ ] **E2 Event Bus:** Often missing the subscriber notification path — verify that a new `price_alerts` row immediately triggers a test event through the bus (not just that CRUD endpoints work)
- [ ] **E3 Greeks:** Often missing null-IV handling — verify that options with no Deribit IV data return a structured error, not a Greek value computed from IV=0
- [ ] **E4 Backfill:** Often missing the completion signal — verify that a completed backfill writes a terminal status to D1 and stops re-queuing itself
- [ ] **E5 Binance:** Often missing the health check — verify that a deployed Worker's Binance connectivity is tested on startup, not assumed
- [ ] **A3 Alert Delivery:** Often missing idempotency — verify that a duplicate queue message (Cloudflare guarantees at-least-once) doesn't send two Telegram notifications for one event
- [ ] **D1 Auth:** Often missing session revocation — verify that a `DELETE /auth/session` call actually invalidates the token on next request, not just deletes the client cookie
- [ ] **D5 API Keys:** Often missing rate limiting — verify that issued API keys have per-key rate limits enforced at the Worker level, not just documented
- [ ] **B2 Backtesting:** Often missing survivorship bias warning — verify that the UI displays a disclaimer if the backtest period includes pairs that were delisted (missing data ≠ zero returns)
- [ ] **D6 SEO Pages:** Often missing cache invalidation — verify that a Cloudflare cache purge is triggered when underlying symbol data changes, not just on deploy

---

## Recovery Strategies

| Pitfall                                 | Recovery Cost | Recovery Steps                                                                                                                                                                              |
| --------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DO hibernation drops subscriber state   | MEDIUM        | Re-implement subscriber storage in DO `storage` API; existing connections must re-subscribe (can be triggered client-side automatically on reconnect)                                       |
| D1 schema rot from un-wired columns     | HIGH          | Schema cannot be destructively cleaned (additive-only constraint); add a companion `_meta` table that tracks column lifecycle; future agents use meta table instead of inferring from nulls |
| Queue backfill deadlock (stuck jobs)    | LOW           | Add a D1 `failed_at` column with timestamp; write a Workers cron that resets `in_progress` jobs older than 30 minutes to `pending`; add DLQ                                                 |
| Binance geo-block unresolved at Phase 2 | HIGH          | All Phase 2 calculations must be explicitly scoped to non-Binance exchanges with UI disclosure; retroactively adding Binance requires re-running all aggregate calculations                 |
| DO CPU limit hit in production          | HIGH          | Requires architectural refactor to shard DO by topic; existing client connections must be migrated; plan for 1-2 week engineering effort                                                    |
| Magic-link tokens compromised via logs  | HIGH          | Rotate all active sessions via D1 mass-update; issue incident disclosure; add log scrubbing pipeline before next deploy                                                                     |
| Black-Scholes computing from null IV    | LOW           | Add NOT NULL constraint or application-level guard; affected rows return structured error; no data corruption                                                                               |

---

## Pitfall-to-Phase Mapping

| Pitfall                                      | Prevention Phase                                 | Verification                                                                                                          |
| -------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| DO hibernation drops subscriber state        | Phase 1 / A0                                     | Traffic lull test: confirm messages resume after 60s of silence without client reconnect                              |
| D1 schema rot                                | Phase 1 / E2                                     | Schema review: every new column has a migration comment and backfill plan                                             |
| Exchange rate limit collapse in backfill     | Phase 1 / E4                                     | Load test: run backfill for 50 pairs and confirm queue drains within 24h without 429 accumulation                     |
| Binance geo-block unresolved                 | Phase 1 / E5                                     | Health check endpoint: `/health/exchanges` returns explicit Binance status (`available`/`geo_blocked`/`excluded`)     |
| Liquidation math on mismatched OI timestamps | Phase 2 / A1                                     | Data coherence test: all inputs to liquidation calculation have timestamps within 5s of each other                    |
| Black-Scholes with uninterpolated IV         | Phase 1 / E3                                     | IV coverage test: verify Greeks are not computed when IV is null; verify strike/expiry coverage is documented         |
| DO fanout CPU limit at scale                 | Phase 1 / A0 (design) + Phase 2 / A4 (load test) | Benchmark: 2,000 concurrent WS clients receiving 50 messages/second without DO CPU warnings                           |
| Magic-link session revocation gap            | Phase 5 / D1                                     | Auth test: confirm token is rejected immediately after logout; confirm 401 on second magic-link use                   |
| SSRF via webhook URL                         | Phase 3 / A3                                     | Security test: attempt to set webhook to `http://169.254.169.254`; verify 400 response                                |
| API key plaintext storage                    | Phase 5 / D5                                     | Schema audit: confirm `api_keys` table stores only hash, never raw key; confirm no raw key in logs                    |
| R2 per-candle object layout                  | Phase 1 / E4                                     | Object count test: confirm R2 layout is monthly batches before backfill starts (cannot be restructured cheaply after) |
| CVD tape accumulation in DO                  | Phase 4 / B1                                     | Storage test: after 24h of B1 running, confirm DO storage < 10MB by checking CVD is incremental                       |

---

## Sources

- Cloudflare Durable Objects hibernation API: https://developers.cloudflare.com/durable-objects/api/websockets/ (HIGH confidence — official docs)
- Cloudflare Workers CPU limits: https://developers.cloudflare.com/workers/platform/limits/ (HIGH confidence — official docs)
- Cloudflare D1 limits and constraints: https://developers.cloudflare.com/d1/platform/limits/ (HIGH confidence — official docs)
- Cloudflare R2 limits: https://developers.cloudflare.com/r2/platform/limits/ (HIGH confidence — official docs)
- CCXT bundle size issue in Workers: known community issue; tree-shaking required (MEDIUM confidence — community knowledge)
- Deribit WebSocket keepalive requirements: Deribit API docs specify 60s idle timeout (MEDIUM confidence — Deribit documentation)
- Black-Scholes IV surface interpolation: standard derivatives mathematics (HIGH confidence — domain knowledge)
- Exchange rate limit behavior: Binance/Bybit/OKX public docs and CCXT rate limit documentation (MEDIUM confidence — varies by exchange)
- Crypto platform session security: OWASP guidance applied to magic-link patterns (HIGH confidence — established security practice)

---

_Pitfalls research for: edge-native crypto market intelligence platform (Lazuli)_
_Researched: 2026-07-11_
