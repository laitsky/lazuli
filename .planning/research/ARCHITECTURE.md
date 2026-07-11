# Architecture Research

**Domain:** Edge-native crypto market intelligence platform (real-time liquidations, derivatives analytics, push alerts)
**Researched:** 2026-07-11
**Confidence:** HIGH — architecture is largely dictated by the existing codebase; this documents what exists, what's missing, and the patterns to enforce going forward.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                      │
│  ┌────────────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
│  │  React + Vite SPA  │   │  WebSocket Client │   │  Push (TG/Discord/ │  │
│  │  (Workers Static   │   │  (topic sub)      │   │  Webhook/Email)    │  │
│  │   Assets)          │   │                  │   │                    │  │
│  └────────┬───────────┘   └────────┬─────────┘   └────────────────────┘  │
└───────────┼────────────────────────┼────────────────────────────────────┘
            │ HTTP /api/v1/          │ WS /ws?topic=...
┌───────────▼────────────────────────▼────────────────────────────────────┐
│                      CLOUDFLARE WORKERS (Hono)                           │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────┐  ┌──────────────┐  │
│  │  REST routes │  │  /ws endpoint │  │  Admin     │  │  Queue       │  │
│  │  /api/v1/    │  │  (DO proxy)   │  │  routes    │  │  consumer    │  │
│  └──────┬───────┘  └───────┬───────┘  └─────┬──────┘  └──────┬───────┘  │
│         │                  │                │                 │          │
│  ┌──────▼──────────────────▼───────────────▼─────────────────▼────────┐ │
│  │                     Service Layer                                   │ │
│  │  ccxtService  backfillService  marketIntelligenceService            │ │
│  │  institutionalService  growthRetentionService  priceArbitrageService│ │
│  └──────┬───────────────────────────────────────────┬─────────────────┘ │
└─────────┼───────────────────────────────────────────┼──────────────────┘
          │ DO RPC                                     │ DO RPC
┌─────────▼────────────────────┐   ┌──────────────────▼──────────────────┐
│   MarketDataCacheV2DO         │   │         RealtimeHubV2DO             │
│   (exchange data cache)       │   │  (pub/sub WS broker + snapshot buf) │
│   48 MB bounded memory cache  │   │  256-event rolling buffer           │
│   TTL policies per resource   │   │  topic-scoped broadcast + hibernate │
└──────────┬────────────────────┘   └──────────────────┬──────────────────┘
           │ CCXT fetch-on-miss                         │ publish (POST /publish)
┌──────────▼────────────────────────────────────────────▼──────────────────┐
│                    EXTERNAL DATA SOURCES                                   │
│  Binance  Bybit  OKX  Hyperliquid  Upbit  (via CCXT)                     │
│  Deribit (options IV — direct REST)                                       │
│  Farside (ETF flows — scraped)                                            │
│  CoinGecko (Fear & Greed — REST)                                          │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                        PERSISTENCE LAYER                                   │
│  ┌────────────────────┐  ┌──────────────────┐  ┌────────────────────────┐ │
│  │  Cloudflare D1     │  │  Cloudflare R2   │  │  Analytics Engine      │ │
│  │  (metadata, users, │  │  (OHLCV archive, │  │  (KPIs, latency,       │ │
│  │   alerts, sessions,│  │   monthly NDJSON │  │   subscriber counts,   │ │
│  │   backtests,       │  │   by exchange/   │  │   WS connections)      │ │
│  │   signal lab,      │  │   symbol/tf)     │  │                        │ │
│  │   backfill jobs)   │  │                  │  │                        │ │
│  └────────────────────┘  └──────────────────┘  └────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                     ASYNC / ORCHESTRATION                                  │
│  ┌────────────────────────────┐   ┌───────────────────────────────────┐   │
│  │  Cloudflare Queues         │   │  Cloudflare Workflows             │   │
│  │  (OHLCV backfill tasks,    │   │  (BackfillWorkflow: fan-out job   │   │
│  │   retry with exponential   │   │   → queue messages, durable step  │   │
│  │   backoff, max 5 attempts) │   │   execution with retries)         │   │
│  └────────────────────────────┘   └───────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component                     | Responsibility                                                                                                         | Implementation                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Cloudflare Worker (Hono)**  | HTTP routing, auth middleware, rate limiting, queue consumption, WebSocket upgrade proxy                               | `apps/api/src/index.ts` — Hono app exported as default |
| **MarketDataCacheV2DO**       | 48 MB bounded in-memory cache for exchange data; stale-while-revalidate TTL policies; fetch-on-miss via CCXT           | `services/MarketDataCacheDO.ts`                        |
| **RealtimeHubV2DO**           | WebSocket pub/sub broker; topic-scoped broadcast; 256-event rolling snapshot buffer; hibernation-safe                  | `services/RealtimeHubDO.ts`                            |
| **ccxtService**               | CCXT adapter for Binance/Bybit/OKX/Hyperliquid/Upbit; tickers, markets, OHLCV, orderbook, funding                      | `services/ccxtService.ts`                              |
| **backfillService**           | D1 job/task CRUD; R2 NDJSON write; Queue enqueue; Workflow fan-out; exponential retry                                  | `services/backfillService.ts`                          |
| **marketIntelligenceService** | Liquidation math, funding radar, order flow (CVD), RSI, backtesting, signal evaluation                                 | `services/marketIntelligenceService.ts`                |
| **institutionalService**      | Deribit options chain/IV/expiries, ETF flows (Farside), Greeks (Black-Scholes)                                         | `services/institutionalService.ts`                     |
| **growthRetentionService**    | Auth (magic-link/passkey), sessions, API keys, watchlists, workspaces, alerts, saved backtests                         | `services/growthRetentionService.ts`                   |
| **D1**                        | Control-plane: users, sessions, passkeys, API keys, price_alerts, backfill_jobs, backfill_tasks, signal_lab_strategies | Cloudflare D1 — additive-only migrations               |
| **R2**                        | Historical OHLCV archive: `{exchange}/{symbol}/{type}/{timeframe}/{YYYY-MM}.ndjson`                                    | Cloudflare R2 — immutable monthly objects              |
| **Analytics Engine**          | KPI instrumentation: WS connection counts, alert subscriber counts, latency p95, backtest runs                         | Cloudflare Analytics Engine dataset                    |
| **React SPA**                 | Market workspace, liquidation heatmap, options surface, signal lab UI, alpha feed                                      | `apps/web/src/` — Workers Static Assets                |

---

## Recommended Project Structure

The existing structure is correct. Enforce it — do not drift from it.

```
lazuli/
├── apps/
│   ├── api/                        # Cloudflare Worker
│   │   ├── src/
│   │   │   ├── index.ts            # Hono app + Worker entrypoint + Workflow def
│   │   │   ├── types/
│   │   │   │   └── index.ts        # Env bindings, BackfillQueueMessage, OHLCV, Timeframe
│   │   │   ├── errors/
│   │   │   │   └── index.ts        # Typed error codes + factory functions
│   │   │   ├── utils/
│   │   │   │   ├── response.ts     # successResponse / handleError
│   │   │   │   ├── security.ts     # Rate limiting, CORS, admin auth, security headers
│   │   │   │   ├── validation.ts   # Simple param validators
│   │   │   │   ├── requestValidation.ts  # Zod schemas for complex request bodies
│   │   │   │   ├── features.ts     # Feature flags from env vars
│   │   │   │   └── logger.ts       # Structured logging
│   │   │   └── services/
│   │   │       ├── MarketDataCacheDO.ts    # Durable Object: exchange data cache
│   │   │       ├── RealtimeHubDO.ts        # Durable Object: WS pub/sub broker
│   │   │       ├── ccxtService.ts          # CCXT exchange adapter
│   │   │       ├── backfillService.ts      # OHLCV backfill orchestration
│   │   │       ├── marketIntelligenceService.ts  # Liquidations, CVD, backtesting
│   │   │       ├── institutionalService.ts # Options Greeks, ETF flows
│   │   │       ├── growthRetentionService.ts # Auth, accounts, alerts, persistence
│   │   │       ├── priceArbitrageService.ts
│   │   │       ├── technicalIndicatorService.ts
│   │   │       ├── emaService.ts
│   │   │       └── memoryCache.ts          # BoundedMemoryCache utility
│   │   └── wrangler.jsonc                  # DO bindings, R2, D1, Queues, rate limiters
│   └── web/                        # React + Vite SPA
│       └── src/
│           ├── App.tsx             # Router
│           ├── pages/              # Route-level components (one per page)
│           └── components/         # Shared UI components
│               ├── shell/          # AppFrame, Sidebar, Topbar
│               ├── ui/             # Design system primitives
│               └── charts/         # Lightweight Charts wrappers
├── packages/
│   └── shared/                     # Types shared between api and web
│       └── src/                    # Tickers, OHLCV, Timeframe, etc.
└── turbo.json                      # Turborepo pipeline
```

### Structure Rationale

- **`services/` is flat, not domain-nested:** Workers are single-file bundles; deep nesting adds import complexity with zero runtime benefit. Keep services flat until you have >20 service files.
- **`types/index.ts` owns `Env`:** All Cloudflare binding types (`D1Database`, `DurableObjectNamespace`, etc.) live here; Worker entrypoint and services import from here.
- **`packages/shared/` for cross-app types:** Prevents `apps/web` from importing `apps/api` types directly. All shared interfaces (Ticker, OHLCV, Timeframe) go here.
- **Durable Object classes in `services/`:** Co-locating DOs with services avoids a confusing `durable-objects/` directory — the DO _is_ the service for its domain.

---

## Architectural Patterns

### Pattern 1: Durable Object as Edge-Native Cache (stale-while-revalidate)

**What:** A single named DO instance per exchange holds all ticker/market/funding data in a bounded in-memory map. On miss, it fetches from CCXT and stores the result. On stale hit, it returns the cached value immediately and revalidates in the background.

**When to use:** Any data that multiple concurrent Worker requests would otherwise fetch from the same external API. DO serializes the fan-in, eliminating thundering-herd against exchange rate limits.

**Trade-offs:** DO memory is capped at ~128 MB per instance; the 48 MB `MAX_CACHE_BYTES` limit plus eviction policy prevents OOM. Instance affinity means the DO may be cold after hibernation — first request pays latency.

```typescript
// Worker route → DO fetch pattern (existing)
const stub = env.MARKET_DATA_CACHE.get(env.MARKET_DATA_CACHE.idFromName(`cache:${exchange}`));
const res = await stub.fetch(new Request(`https://do/tickers?exchange=${exchange}&type=perp`));
const { data, meta } = await res.json();
```

**Cache TTL policies (enforced in `MarketDataCacheDO.ts`):**
| Resource | Fresh TTL | Stale TTL |
|----------|-----------|-----------|
| tickers | 15 s | 5 min |
| orderbook | 5 s | 30 s |
| funding | 60 s | 10 min |
| markets | 6 h | 24 h |
| institutional | 5 min | 30 min |
| ohlcv 1m | 15 s | 30 min |

---

### Pattern 2: Durable Object as WebSocket Pub/Sub Broker (hibernation-aware)

**What:** `RealtimeHubV2DO` is the single WS broker for all real-time topics (tickers, liquidations, alerts, order-book deltas). Workers upgrade the client connection, then hand the socket to the DO via `ctx.acceptWebSocket(server, [topic])`. The DO broadcasts to all sockets tagged with a topic. A 256-event rolling buffer lets reconnecting clients replay missed events via `/snapshot`.

**When to use:** Every real-time push from server → client goes through this DO. Publishers POST to `/publish` with an admin key. Clients subscribe by opening a WS to `/ws?topic=...`.

**Trade-offs:** All sockets for a topic must land on the same DO instance (use a consistent name like `hub:global`). Hibernation (`ctx.acceptWebSocket`) means the DO sleeps when no messages arrive — zero cost at idle. Max 256 events in snapshot buffer; clients that reconnect after a larger gap must do a full re-fetch of current state.

```typescript
// Worker: upgrade client WS and proxy to DO (pattern for A0/A4)
app.get('/ws', async (c) => {
  const upgrade = c.req.header('Upgrade');
  if (upgrade?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'WebSocket required' }, 426);
  }
  const topic = c.req.query('topic');
  const stub = c.env.REALTIME_HUB.get(c.env.REALTIME_HUB.idFromName('hub:global'));
  return stub.fetch(
    new Request(`https://do/ws?topic=${topic}`, {
      headers: c.req.raw.headers,
    })
  );
});

// Exchange ingest Worker: publish to hub
async function publishToHub(env: Env, topic: string, data: unknown) {
  const stub = env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName('hub:global'));
  await stub.fetch(
    new Request(`https://do/publish?topic=${topic}`, {
      method: 'POST',
      headers: { 'X-Admin-API-Key': env.ADMIN_API_KEY! },
      body: JSON.stringify(data),
    })
  );
}
```

---

### Pattern 3: Queue + Workflow for Durable Async Work

**What:** Long-running backfill jobs are not done inside a Worker request. The `/admin/backfill` route creates a job in D1, then triggers a `BackfillWorkflow` which fans the job into individual chunk tasks enqueued on `BACKFILL_QUEUE`. The queue consumer Worker processes each chunk: fetches OHLCV from CCXT, writes NDJSON to R2, updates D1 task status.

**When to use:** Any operation that exceeds a Worker's 30-second CPU budget, requires durable retry, or fans out to hundreds of sub-tasks. Specifically: OHLCV backfill (E4), future alert batch evaluation (A3).

**Trade-offs:** Cloudflare Workflows are durable but have step limits. Keep each Workflow step lightweight — fan out via Queue, not nested Workflow steps. Max 5,000 tasks per job to stay within Queue write budget.

```typescript
// Workflow step pattern (existing in index.ts)
export class BackfillWorkflow extends WorkflowEntrypoint<Env, BackfillWorkflowParams> {
  async run(event: WorkflowEvent<BackfillWorkflowParams>, step: WorkflowStep) {
    const job = await step.do('load-job', () => getBackfillJob(this.env, event.payload.jobId));
    await step.do('enqueue-tasks', () => enqueuePendingTasks(this.env, job));
    // Each task is an independent queue message → processed by queue consumer
  }
}
```

---

### Pattern 4: D1 as Control-Plane Only (no time-series)

**What:** D1 stores job records, user accounts, sessions, alert configs, signal lab strategies, watchlists, and workspaces. It never stores OHLCV data — that's R2's domain. D1 schemas use additive-only migrations; no column drops, no table renames.

**When to use:** Structured metadata with relational queries. Never for high-frequency writes (>100/s) or large binary data.

**Trade-offs:** D1 has ~10ms round-trip from Worker (same region). Avoid N+1 queries — batch with `db.batch([...])`. D1's SQLite engine does not support `RETURNING` on older schemas — test migrations before deploying.

**R2 key scheme for OHLCV archives:**

```
{exchange}/{symbol}/{type}/{timeframe}/{YYYY-MM}.ndjson
# e.g.: binance/BTC-USDT/spot/1h/2024-01.ndjson
```

Each file is append-idempotent (overwritten per month-chunk); the backfill service tracks the last written timestamp in D1 task rows.

---

### Pattern 5: Feature Flags via Environment Variables

**What:** Cloudflare env vars (set via `wrangler secret` or `wrangler.jsonc` vars) gate feature visibility at runtime without a redeployment. Existing flags: `ACCOUNT_FEATURES_ENABLED`, `ALERT_EVALUATION_ENABLED`, `ADMIN_ROUTES_ENABLED`.

**When to use:** Ship unfinished features to production behind a flag. Validate in staging before flipping. Never ship a flag that stays off for >2 sprints — either graduate or delete it.

```typescript
// Existing pattern in utils/features.ts
if (!featureEnabled(c.env.ACCOUNT_FEATURES_ENABLED)) {
  return c.json(featureDisabledEnvelope('accounts'), 503);
}
```

---

## Data Flow

### 1. Real-Time Market Data Flow (target: p95 < 800 ms)

```
Exchange WebSocket feed
    ↓
[Ingest Worker / scheduled fetch]
    ↓ POST /publish?topic=liquidations:BTC-USDT
RealtimeHubV2DO
    ↓ broadcast to all subscribed sockets
Client WebSocket (React SPA)
    ↓
UI update (liquidation heatmap, alert badge)
```

**Current gap (A0):** The ingest side (exchange WS → DO publish) does not exist yet. `RealtimeHubV2DO` is complete; what's missing is the producer that feeds it.

---

### 2. REST Request Flow (cached path)

```
React SPA → GET /api/v1/tickers/bybit?type=perp
    ↓
Worker (Hono route handler)
    ↓ rate limit check (PUBLIC_RATE_LIMITER)
    ↓ DO RPC: stub.fetch("https://do/tickers?exchange=bybit&type=perp")
MarketDataCacheV2DO
    ├── cache HIT  → return { data, meta.cache: "hit" }
    └── cache MISS → ccxtService.getAllTickers("bybit") → Bybit REST API
                        ↓ store in BoundedMemoryCache
                        ↓ return { data, meta.cache: "miss" }
    ↓
Worker → Response.json({ success: true, data, meta })
    ↓
React SPA
```

---

### 3. Alert Delivery Flow (E2 → A3)

```
D1: price_alerts table (CRUD live, delivery not yet wired)
    ↓ [scheduled Worker or Queue trigger]
growthRetentionService.listDuePriceAlerts(env)
    ↓ evaluateAlertTrigger(alert, currentPrice)
    ├── Telegram → ALERT_TELEGRAM_BOT_TOKEN
    ├── Discord → ALERT_DISCORD_WEBHOOK_URL
    ├── Webhook → ALERT_DELIVERY_WEBHOOK_URL (HMAC-signed)
    └── Email → ALERT_EMAIL_DELIVERY_WEBHOOK_URL (relay)
    ↓ mark alert as delivered in D1
```

---

### 4. OHLCV Backfill Flow

```
POST /admin/backfill (admin-gated)
    ↓ createBackfillJob(env, params) → D1 insert
    ↓ env.BACKFILL_WORKFLOW.create({ jobId })
BackfillWorkflow (Cloudflare Workflow)
    ↓ step: load job from D1
    ↓ step: enqueuePendingTasks → BACKFILL_QUEUE (up to 5,000 messages)
Queue Consumer (Worker)
    ↓ processBackfillMessage(env, msg)
        ↓ ccxtService.fetchOHLCV(exchange, symbol, tf, type, limit)
        ↓ write NDJSON to R2: {exchange}/{symbol}/{type}/{tf}/{YYYY-MM}.ndjson
        ↓ D1: update task status → 'completed'
    ↓ retry on failure (max 5 attempts, exponential backoff via queueRetryDelaySeconds)
```

---

### 5. Auth Flow (D1 — magic-link/passkey, no passwords)

```
POST /auth/magic-link (email) → createMagicLink(env, email) → D1 insert + webhook delivery
GET  /auth/magic-link/verify?token=... → validate, create session in D1
POST /auth/passkey/register/begin → WebAuthn challenge (D1 store)
POST /auth/passkey/register/complete → store credential in D1
POST /auth/passkey/authenticate/begin → WebAuthn challenge
POST /auth/passkey/authenticate/complete → validate, create session in D1
```

---

## Scaling Considerations

| Scale                | Approach                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–2k concurrent WS   | Single `hub:global` DO handles all topics. Hibernation keeps cost near zero at idle.                                                                                                                                       |
| 2k–20k concurrent WS | Shard by topic namespace: `hub:liquidations`, `hub:tickers`, `hub:alerts`. Worker routes WS to the right DO by topic prefix.                                                                                               |
| 20k+ concurrent WS   | Further shard by symbol: `hub:liquidations:BTC`, `hub:liquidations:ETH`. Each DO handles one symbol's subscribers.                                                                                                         |
| D1 write pressure    | Alert evaluation and session writes are the primary D1 write paths. At 5k alert subscribers, batch evaluate with `db.batch([...])` instead of per-row round-trips.                                                         |
| R2 read pressure     | OHLCV reads for backtesting are large monthly files. Add a Cache API layer (`caches.default.match(r2Url)`) in front of R2 reads for identical backtest queries.                                                            |
| CCXT rate limits     | MarketDataCacheDO serializes exchange fan-in at the DO level. For Binance (heaviest user), the geo-block (E5) may force fallback to Bybit/OKX as primary. Design ccxtService to handle exchange unavailability gracefully. |

### Scaling Priorities (in order)

1. **First bottleneck: RealtimeHubDO broadcast throughput.** At 2k subscribers all on one DO, a single broadcast loop blocks the DO event loop. Shard by topic at ~500 connections/DO to keep broadcast < 10 ms.
2. **Second bottleneck: D1 read latency on alert evaluation.** A scheduled Worker checking 5k price alerts in serial will hit D1 row-read limits. Batch `SELECT` with `WHERE status = 'active'` and evaluate in-memory.
3. **Third bottleneck: R2 egress for backtest reads.** Monthly NDJSON files can be 50–200 MB. Stream-parse them with a NDJSON line reader rather than loading the full file into Worker memory.

---

## Anti-Patterns

### Anti-Pattern 1: Using D1 as a Time-Series Database

**What people do:** Store every liquidation event, every ticker update, or every funding rate in D1 rows.
**Why it's wrong:** D1 is SQLite — it's not optimized for append-only high-frequency writes. At 1k liquidations/minute, D1 will exceed its write budget and row count targets within days.
**Do this instead:** High-frequency events go to R2 as NDJSON (archived) or stay in DO memory (hot/recent). D1 stores only job records, user data, and alert configurations.

---

### Anti-Pattern 2: Fetching Exchange Data on Every Worker Request

**What people do:** Call `ccxtService.getAllTickers("bybit")` directly inside a route handler without going through the DO cache.
**Why it's wrong:** Each Worker instance makes its own HTTP request to Bybit. With 100 concurrent Worker instances, that's 100 simultaneous requests to the same exchange endpoint — triggering rate limits and inflating response times.
**Do this instead:** All exchange data reads go through `MarketDataCacheV2DO`. The DO serializes concurrent requests into a single outbound fetch and serves the rest from memory.

---

### Anti-Pattern 3: Storing Secrets in Worker Code or `wrangler.jsonc` vars

**What people do:** Put API keys or signing secrets in `wrangler.jsonc` under `[vars]` or hardcode them in TypeScript.
**Why it's wrong:** `[vars]` values are stored in plain text in Cloudflare's dashboard and visible to anyone with account access. Hardcoded secrets ship in the Worker bundle.
**Do this instead:** All secrets (`ADMIN_API_KEY`, `INGEST_SIGNING_SECRET`, `REALTIME_TOKEN_SECRET`, `ALERT_TELEGRAM_BOT_TOKEN`, etc.) must be set via `wrangler secret put`. The `Env` interface declares them as `string | undefined` — treat absence as "feature disabled."

---

### Anti-Pattern 4: Bypassing the Additive Migration Constraint

**What people do:** Write a D1 migration that drops a column, renames a table, or changes a column type to fix a schema mistake.
**Why it's wrong:** Cloudflare Workers deploy globally but D1 migrations run once — there's a window where the new Worker code and old schema coexist. A destructive migration breaks the running Worker mid-deploy, causing 5xx errors.
**Do this instead:** Always add new columns (`ALTER TABLE ... ADD COLUMN ... DEFAULT ...`), new tables, or new indexes. Never drop. If you need to remove a column, leave it nullable, stop writing to it, and formally deprecate it in a comment. Delete it only in a future major version with a coordinated deploy.

---

### Anti-Pattern 5: One `RealtimeHubDO` Instance per User

**What people do:** Create a separate DO instance for each user's WebSocket connection (`idFromName(userId)`).
**Why it's wrong:** This defeats the pub/sub broadcast model. You get N individual DOs that can't broadcast to each other, and you lose the rolling event buffer.
**Do this instead:** Use a small number of named hub shards by topic domain (`hub:liquidations`, `hub:tickers`, `hub:alerts`). All clients for a topic domain share one DO instance — that's how broadcast works.

---

## Integration Points

### External Services

| Service          | Integration Pattern                                | Key Constraint                                                                 |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Binance          | CCXT via `MarketDataCacheV2DO`                     | Geo-blocked from Cloudflare PoPs — E5 must resolve this (proxy or PoP routing) |
| Bybit            | CCXT via `MarketDataCacheV2DO`                     | Primary fallback if Binance unavailable                                        |
| OKX              | CCXT via `MarketDataCacheV2DO`                     |                                                                                |
| Hyperliquid      | CCXT via `MarketDataCacheV2DO`                     | Perp only; DEX — no KYC friction                                               |
| Upbit            | CCXT via `MarketDataCacheV2DO`                     | Spot only; Korean exchange; KRW pairs require currency conversion              |
| Deribit          | Direct REST (institutionalService)                 | Options IV, chain, expiries; no CCXT wrapper needed                            |
| Farside          | HTTP scrape (institutionalService)                 | ETF flows; HTML scraping — fragile; cache aggressively                         |
| CoinGecko        | Direct REST (institutionalService)                 | Fear & Greed index; free tier rate-limited                                     |
| Telegram Bot     | `ALERT_TELEGRAM_BOT_TOKEN` → Bot API               | Used for push alerts (A3)                                                      |
| Discord          | `ALERT_DISCORD_WEBHOOK_URL` → Webhook              | Used for push alerts (A3)                                                      |
| Magic-link email | `MAGIC_LINK_DELIVERY_WEBHOOK_URL` (external relay) | Lazuli doesn't send email directly — it POSTs to a webhook relay               |

### Internal Boundaries

| Boundary                     | Communication                                    | Notes                                                               |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| Worker ↔ MarketDataCacheV2DO | DO RPC (stub.fetch)                              | HTTP semantics over internal Cloudflare network; ~1–3 ms            |
| Worker ↔ RealtimeHubV2DO     | DO RPC (stub.fetch)                              | WebSocket upgrade + publish both go through DO fetch                |
| Worker → BACKFILL_QUEUE      | `env.BACKFILL_QUEUE.send(msg)`                   | Fire-and-forget; consumer is a separate Worker handler              |
| Worker → BACKFILL_WORKFLOW   | `env.BACKFILL_WORKFLOW.create(params)`           | Durable; survives Worker restarts                                   |
| Worker ↔ D1                  | `env.DB.prepare(sql).bind(...).all()`            | Synchronous-feeling but async; batch with `db.batch([...])`         |
| Worker ↔ R2                  | `env.OHLCV_ARCHIVE.get(key)` / `.put(key, body)` | Streaming reads preferred for large NDJSON files                    |
| Worker → Analytics Engine    | `env.API_ANALYTICS.writeDataPoint(...)`          | Non-blocking; fire-and-forget; do not await in critical paths       |
| apps/web ↔ apps/api          | HTTP (fetch) in browser / WS                     | All communication via public `/api/v1/` contract; no direct imports |
| apps/api ↔ packages/shared   | TypeScript imports                               | Shared types only — no logic in shared package                      |

---

## Sources

- Cloudflare Durable Objects docs (hibernatable WebSockets, storage API): https://developers.cloudflare.com/durable-objects/
- Cloudflare Workflows docs: https://developers.cloudflare.com/workflows/
- Cloudflare Queues docs: https://developers.cloudflare.com/queues/
- Cloudflare D1 docs (additive migrations, batch API): https://developers.cloudflare.com/d1/
- Cloudflare R2 docs: https://developers.cloudflare.com/r2/
- Cloudflare Analytics Engine docs: https://developers.cloudflare.com/analytics/analytics-engine/
- Hono docs: https://hono.dev/docs
- CCXT unified API: https://docs.ccxt.com/
- Existing codebase: `apps/api/src/services/RealtimeHubDO.ts`, `MarketDataCacheDO.ts`, `backfillService.ts`, `types/index.ts`

---

_Architecture research for: Lazuli — edge-native crypto market intelligence platform_
_Researched: 2026-07-11_
_Confidence: HIGH — based on existing codebase + Cloudflare official docs_
