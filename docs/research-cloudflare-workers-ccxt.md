# Research: Cloudflare Workers + CCXT Compatibility

**Date:** 2026-06-17
**Status:** Complete
**Verdict:** Migration is **feasible with caveats**. CCXT does NOT work out-of-the-box on Workers, but the situation has significantly improved as of September 2025. See Section 1 for the critical path and Section 2 for lower-risk alternatives.

---

## TL;DR / Key Recommendations

| Topic                             | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Risk                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **CCXT on Workers**               | Does NOT work out-of-the-box. CCXT's runtime detection (`isNode`) and reliance on Node `http`/`https` historically broke Workers. As of **September 2025**, Workers added `node:http` client + server (via `nodejs_compat`), which unblocks most Node HTTP clients. With `nodejs_compat` + recent compatibility date, **CCXT 4.x should now load and make REST requests**, but this is **unverified** for the full 100+ exchange surface. CCXT is also NOT in the `worksonworkers.southpolesteve.workers.dev` tested list (992 packages). | **HIGH** - must be prototyped before committing |
| **Recommended path**              | **Option B (direct `fetch()` per exchange)** is the lowest-risk. Exchange REST APIs are simple JSON-over-HTTPS; CCXT's value-add (unified schema) can be partially reimplemented for the 3 exchanges Lazuli uses (Binance, Bybit, OKX).                                                                                                                                                                                                                                                                                                   | Medium                                          |
| **Background polling (every 5s)** | **Durable Objects with Alarms** is the canonical pattern. Cron Triggers cannot go below 1 minute. Durable Object alarms can fire at arbitrary intervals (sub-second possible).                                                                                                                                                                                                                                                                                                                                                            | Low                                             |
| **PostgreSQL (Supabase)**         | Use **Hyperdrive** to keep Supabase Postgres. Do NOT migrate to D1 (SQLite). Hyperdrive has an official Supabase example and supports `pg`, `postgres.js`, Drizzle, Kysely.                                                                                                                                                                                                                                                                                                                                                               | Low                                             |
| **Redis replacement**             | Workers Cache API for short-TTL HTTP-style caching; KV for cross-request warm cache (note: KV has eventual consistency ~60s). For true Redis semantics, **Upstash Redis** (HTTP-based, Workers-compatible) is the closest drop-in.                                                                                                                                                                                                                                                                                                        | Low-Medium                                      |
| **React frontend**                | **Workers + Static Assets** is now the recommended replacement for Cloudflare Pages. Pages is being folded into Workers. SPA mode is a one-line config (`not_found_handling: single_page_application`).                                                                                                                                                                                                                                                                                                                                   | Low                                             |
| **WebSockets**                    | Workers now supports **outbound WebSockets** (Durable Objects support inbound WS + Hibernation API). CCXT Pro (WS feeds) could work in a Durable Object, but is unverified.                                                                                                                                                                                                                                                                                                                                                               | Medium                                          |

---

## 1. CCXT on Cloudflare Workers (HIGHEST RISK)

### 1.1 Historical context: Issue #19125 (Sep 2023)

The foundational blocker is [ccxt/ccxt#19125](https://github.com/ccxt/ccxt/issues/19125) ("Cloudflare Workers"). CCXT's `Exchange.ts` runtime detection hard-coded Node.js assumptions and called `node:http`/`node:https` directly. At the time, Workers had no `node:http` support, so the package failed to initialize. The reporter confirmed the only fix was manually forcing `isNode = false` to route through browser-style `fetch`.

The issue is still **open** (label: `question`, assignee: sc0Vu). No upstream fix has landed that adds a first-class Cloudflare Workers runtime branch.

### 1.2 What changed in September 2025 (critical update)

Cloudflare shipped **`node:http` and `node:https` client support in Workers** (September 2025), as part of the broader "nodejs_compat" effort. References:

- Blog: [Bringing Node.js HTTP servers to Cloudflare Workers](https://blog.cloudflare.com/bringing-node-js-http-servers-to-cloudflare-workers/) (2025-09-17)
- Blog: [A year of improving Node.js compatibility in Cloudflare Workers](https://blog.cloudflare.com/nodejs-workers-2025/) (2025-09-25)
- Docs: [node:http on Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)

Key facts from the docs:

- `node:http` client (`http.request`, `http.get`) is implemented **as a wrapper around the global `fetch()` API**.
- Requires `nodejs_compat` flag + `enable_nodejs_http_modules` flag (auto-enabled at compatibility date `2025-08-15` or later).
- The HTTP client **can only be used inside a `fetch()` or similar handler** (it throws outside one).
- `node:net`, `node:tls`, `node:dns`, `node:fs` (virtual in-memory), `node:crypto`, `node:zlib`, `node:stream` are all now available natively.

**Implication for CCXT:** The raw Node.js APIs that CCXT depends on for HTTP are now present. This means CCXT 4.x _should_ be importable and _should_ be able to issue REST requests, **provided**:

1. `nodejs_compat` is enabled.
2. Compatibility date is `2025-08-15` or later.
3. CCXT's `isNode` detection returns `true` (it checks for `process.versions.node`); with `nodejs_compat`, `process` is available and CCXT will likely take the Node code path - which now works because `node:http` exists.

### 1.3 Remaining concerns even with nodejs_compat

These are **not verified** and require a prototype:

1. **`Agent` is a stub.** Workers' `http.Agent` does NOT do connection pooling/keep-alive. CCXT may instantiate Agents; this should not crash (it's a stub) but may affect performance assumptions.
2. **Socket attribute limitations.** `socket` does not extend `net.Socket` and is a limited object. If CCXT reads socket properties (e.g., remoteAddress for TLS verification), behavior may differ.
3. **Bundle size / startup time.** Workers have a **1-second startup time** limit and **10 MB compressed worker size** (Paid plan). CCXT ships code for 100+ exchanges; importing the full package likely produces a multi-MB bundle. The `ccxt-js` package (Node-only subset, 8MB vs 40MB) is 7 years stale and unusable. Single-exchange imports (`import { binance } from 'ccxt'`) help but CCXT's monorepo build pulls in shared base classes regardless.
4. **`fetchImplementation` override.** CCXT 4.x exposes a `fetchImplementation` option on exchanges, which historically has been the workaround for edge runtimes. Setting `exchange.fetchImplementation = fetch` (the global Workers fetch) bypasses `node:http` entirely. This is the **recommended escape hatch** if direct node:http path has issues.
5. **WebSocket (CCXT Pro).** CCXT Pro uses raw sockets / `ws` library for streaming. Workers supports outbound WebSockets but `ws` (the npm package) is not guaranteed to work. **CCXT Pro should be considered unsupported on Workers** unless separately verified. Lazuli's CLAUDE.md does not mention WS, so this is likely a non-issue.

### 1.4 Recommended action for CCXT

**Build a 30-minute spike** before committing to the migration:

1. `npm create cloudflare@latest ccxt-spike` (Workers template).
2. `bun add ccxt`.
3. `wrangler.toml`: `compatibility_flags = ["nodejs_compat"]`, `compatibility_date = "2025-09-23"` (or later).
4. In the handler: `import { binance } from 'ccxt'; const ex = new binance(); const t = await ex.fetchTickers();`.
5. Test locally with `wrangler dev` and deploy to staging.
6. If it fails, fall back to **Option B** below.

---

## 2. Alternative Approaches (if CCXT doesn't work)

### Option A: CCXT with `fetchImplementation` override (medium effort)

Keep CCXT's unified API but force it through Workers' native `fetch`:

```ts
import { binance } from 'ccxt';
const ex = new binance();
ex.fetchImplementation = (url, method, headers, body) => fetch(url, { method, headers, body });
```

This sidesteps `node:http` entirely. Loses some CCXT features (proxy via `httpProxy`) but preserves the unified schema and parsing logic for all 100+ exchanges. Documented pattern; CCXT explicitly supports `fetchImplementation` and there is an active issue (#25486) about using it in Workers with proxies.

### Option B: Direct `fetch()` per exchange (recommended - lowest risk)

Lazuli only uses **Binance, Bybit, OKX**. Each has stable, well-documented REST APIs:

- `GET https://api.binance.com/api/v3/ticker/24hr`
- `GET https://api.bybit.com/v5/market/tickers?category=spot`
- `GET https://api.okx.com/api/v5/market/tickers?instType=SPOT`

Writing a thin client per exchange is straightforward. Benefits:

- Zero compatibility risk.
- Smaller bundle.
- No CPU overhead from CCXT's runtime detection and 100+ exchange classes.
- Workers `fetch()` has built-in subrequest accounting (10,000 per invocation on Paid).

Cost: lose CCXT's unified symbol normalization and OHLCV parsing. For 3 exchanges this is a one-day task.

### Option C: "ccxt/js" modular imports

There is no official "ccxt/js" or browser-only ESM build. The `ccxt` package ships a single unified build. Individual exchange classes can be imported (`import { binance } from 'ccxt'`) which helps bundle size but does not change runtime compatibility. This is an optimization, not a solution.

### Option D: Run CCXT outside Workers

Keep the polling worker on a VPS / Fly.io / Render running Bun (current architecture) and use Workers only for the public-facing API and frontend. This is the **least disruptive** path if the CCXT-on-Workers spike fails and Option B is rejected.

---

## 3. Cloudflare Workers Limits (relevant to this use case)

Source: [Workers Limits docs](https://developers.cloudflare.com/workers/platform/limits/) (verified 2026-06-03).

### 3.1 CPU time

| Plan | Per HTTP request                                          | Per Cron Trigger                                |
| ---- | --------------------------------------------------------- | ----------------------------------------------- |
| Free | **10 ms**                                                 | 10 ms                                           |
| Paid | **5 min** (default 30s; configurable via `limits.cpu_ms`) | 30s (< 1hr interval) / 15 min (>= 1hr interval) |

CPU time = active computation, **not** time spent awaiting `fetch()`, KV reads, or DB queries. Average Worker uses ~2.2 ms/request. CCXT's JSON parsing + signature computation for a handful of tickers should fit comfortably in the 30s default.

### 3.2 Memory

- **128 MB per isolate** (Free and Paid). Includes JS heap + WASM. CCXT's full bundle plus cached market data should fit, but storing all-tickers responses for 3 exchanges is ~10-50 MB - manageable.

### 3.3 Subrequests (outbound fetch/HTTP calls)

| Plan | Per invocation                            |
| ---- | ----------------------------------------- |
| Free | 50                                        |
| Paid | **10,000** (up to 10M via limit increase) |

Polling 3 exchanges every 5 seconds = 3 subrequests per tick. Far within limits.

### 3.4 Simultaneous open connections

- **6 connections** waiting for response headers at any moment (both plans). Once headers arrive, the connection no longer counts. So 3 parallel exchange polls are fine; 7+ parallel polls would queue.

### 3.5 Worker size

- Free: 3 MB compressed. Paid: **10 MB compressed**. CCXT's full bundle likely exceeds 3 MB but should fit in 10 MB. Verify with `wrangler deploy --dry-run`.

### 3.6 Wall time (duration)

- HTTP request: **unlimited** while client connected.
- Cron Trigger / Queue consumer / Durable Object alarm: **15 minutes** per invocation.
- `ctx.waitUntil()` extends execution up to **30 seconds** after response.

### 3.7 Background tasks (5-second polling)

- **No long-running background workers.** Workers are request/event-driven; there is no `setInterval` that survives between requests.
- `setInterval` works _within a single invocation_ but the isolate is ephemeral.

---

## 4. Background Polling Pattern (every 5 seconds)

### 4.1 Cron Triggers - NOT suitable

- Minimum interval is **1 minute** (cron expressions do not support sub-minute).
- 5 Cron Triggers per account (Free), 250 (Paid).
- 15-minute wall time per invocation.
- Not a fit for 5-second polling.

### 4.2 Durable Objects + Alarms - RECOMMENDED

This is the canonical Cloudflare pattern for "warm the cache every N seconds":

- A Durable Object is a **globally unique, single-threaded** instance with persistent storage.
- The **Alarms API** (`storage.setAlarm()`) schedules a future wake-up with **at-least-once delivery**. Alarm handlers can reschedule themselves, creating a self-perpetuating loop at any interval (sub-second possible, though practical floor is ~1s).
- Alarm handler wall time: **15 minutes**.
- On each alarm: poll 3 exchanges, write results to KV / D1 / Durable Object SQLite storage, then `setAlarm(now + 5000ms)`.
- Durable Objects remain in-memory while requests/alarms/WebSockets are active; idle DOs are evicted but alarms will wake them.

**Limits to verify:** Each DO has a soft ~1,000 req/sec limit; single DO is fine for this singleton pattern. SQLite-backed DOs: 10 GB storage per object, 30s default CPU per request (configurable to 5 min).

### 4.3 Cloudflare Queues - secondary option

- Queues are for async message passing, not scheduled polling. Could be used to fan out work but adds latency. Not the right primitive for a 5-second poller.
- Limits: 15-min consumer wall time, message size 128 KiB.

### 4.4 Cloudflare Workflows - not a fit

- Workflows are for multi-step durable execution (retries, state machines). Overkill for a polling loop.

**Recommendation:** Use a single Durable Object named e.g. `PollerCoordinator` with an alarm that fires every 5 seconds, fetches all 3 exchanges, and writes to KV (for the API Worker to read).

---

## 5. D1 vs Hyperdrive for PostgreSQL (Supabase)

### 5.1 Hyperdrive - RECOMMENDED (keep Supabase)

[Hyperdrive](https://developers.cloudflare.com/hyperdrive/) provides **connection pooling + query caching** for existing Postgres/MySQL from Workers. Verified facts:

- **Official Supabase support**: Hyperdrive docs list a Supabase connection example. The Cloudflare Workers + Supabase integration page also documents both the Supabase client and Hyperdrive paths.
- **Supported drivers** (verified from docs): `pg` (node-postgres) >= 8.16.3, `postgres.js` >= 3.4.5, Drizzle >= 0.26.2, Kysely >= 0.26.3. Requires `nodejs_compat` + compatibility date >= `2024-09-23`.
- Uses Workers TCP socket support under the hood; connects to standard Postgres on port 5432 (or Supabase pooler on 6543).
- **Query caching**: Hyperdrive caches read query results at the edge, which is valuable for the Lazuli `/data/latest` and `/data/history` endpoints.
- **Pattern**: Create client per request (`new Client({ connectionString: env.HYPERDRIVE.connectionString })`); Hyperdrive maintains the real pool.

**Verdict:** Use Hyperdrive. Keep Supabase Postgres. This avoids a risky data migration.

### 5.2 D1 (SQLite) - NOT recommended for migration

- D1 is SQLite-based. Migrating from Postgres means rewriting schema (no Postgres-specific types, RLS, JSONB operators change), losing Supabase auth/realtime/storage ecosystem, and SQLite concurrency model differences.
- D1 makes sense for _new_ edge-native projects or simple KV-with-SQL use cases, not for migrating an existing Postgres-backed app.
- Per docs/community: D1 max 10 GB per database; rows-read pricing can surprise at scale.

**Verdict:** Stay on Supabase + Hyperdrive. D1 is the wrong migration target for Lazuli.

---

## 6. Caching: KV vs Durable Objects vs Workers Cache API (Redis replacement)

Lazuli currently uses Redis. Options on Cloudflare:

### 6.1 Workers Cache API

- HTTP-cache semantics backed by Cloudflare's CDN cache.
- **Strengths**: Free, no config, low latency, 512 MB object size, integrates with Cache Rules.
- **Weaknesses**: Regional (not globally consistent), per-request limit 50 (Free) / 1,000 (Paid) cache ops, no TTL finer than what CDN allows, not a general-purpose key-value store.
- **Best for**: Caching the _HTTP responses_ from exchange APIs. If Lazuli's cache pattern is "cache this ticker JSON for 5 seconds", the Cache API is a perfect 1:1 replacement.

### 6.2 Workers KV (Key-Value)

- Globally distributed eventually-consistent KV store.
- **Strengths**: Global reads (~10-50ms), simple API, generous free tier (100k reads/day).
- **Weaknesses**: **Eventually consistent** - writes take up to ~60 seconds to propagate globally. This is **unsuitable** for a 5-second polling cache where the API Worker must read the freshest data immediately.
- **Best for**: Config data, market metadata, slow-changing reference data. Not for the live ticker cache.
- Recent (Oct 2025) update: KV is "up to 3x faster" but consistency model unchanged.

### 6.3 Durable Object storage (SQLite-backed)

- Strongly consistent (single-threaded per object).
- **Strengths**: Perfect consistency, co-located with the poller DO, SQL queries, 10 GB per object.
- **Weaknesses**: Slight overhead for RPC calls; only as fast as the DO region.
- **Best for**: The live ticker cache. The PollerCoordinator DO writes ticker data directly to its SQLite storage; API Workers read via RPC. This gives a strongly consistent 5-second-fresh cache with no external dependency.

### 6.4 Upstash Redis (third-party)

- HTTP-based Redis, fully Workers-compatible. Closest behavioral match to existing Redis code.
- **Strengths**: Drop-in for most Redis patterns, sub-10ms global, pay-per-request.
- **Weaknesses**: External service (cost, vendor lock-in), HTTP not RESP (no pub/sub semantics).
- **Best for**: If minimizing code changes to existing Redis-based caching logic is paramount.

### 6.5 Recommendation

- **Primary**: Durable Object SQLite storage for live ticker data (written by the poller, read via RPC by API Workers). Strongly consistent, zero external cost.
- **Secondary**: Workers Cache API for any HTTP-response caching (e.g., `/api/v1/tickers/:exchange` responses cached for 2-3 seconds).
- **Avoid** for this use case: Workers KV (eventual consistency conflicts with 5-second freshness).
- **Fallback**: Upstash Redis if the team wants minimum code change.

---

## 7. Frontend: Cloudflare Pages vs Workers (React + Vite SPA)

### 7.1 Current state (2026): Pages is being folded into Workers

As of 2026, Cloudflare is consolidating Pages into **Workers + Static Assets**. References:

- Blog: [Your frontend, backend, and database - now in one Cloudflare Worker](https://blog.cloudflare.com/full-stack-development-on-cloudflare-workers/) (2026-02-19)
- Docs: [Migrate from Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) (updated 2026-06-10)
- Community: Multiple Reddit/HN threads confirm Pages UI is being de-emphasized; Workers is the strategic product.

### 7.2 Recommendation: Workers Static Assets

- Deploy the Vite SPA build (`dist/`) as Workers Static Assets.
- SPA routing is a one-line config in `wrangler.toml`:
  ```toml
  [assets]
  directory = "./dist"
  not_found_handling = "single_page_application"
  ```
- Official guide exists: [React + Vite on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/).
- Can serve both the SPA and the API from the same Worker (one deploy, one domain) or split them.
- Free plan: 20,000 asset files per Worker; Paid: 100,000. Individual file 25 MiB. Far exceeds a typical SPA build.

**Verdict:** Use Workers Static Assets. Do not start new projects on Pages. The SPA + API can even live in a single Worker if desired.

---

## 8. Migration Risk Summary & Phasing

| Component                   | Recommendation                                                                              | Risk       | Verification step                             |
| --------------------------- | ------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------- |
| Exchange data fetching      | **Option B: direct fetch()** for 3 exchanges (preferred) OR spike CCXT with `nodejs_compat` | Medium     | Prototype in staging                          |
| Background poller (5s)      | **Durable Object + Alarms**                                                                 | Low        | Build single DO, verify alarm loop            |
| Database                    | **Hyperdrive to Supabase Postgres** (keep existing DB)                                      | Low        | Connect via `pg` driver, run a query          |
| Caching (Redis replacement) | **DO SQLite** for live data + **Cache API** for HTTP responses                              | Low-Medium | Benchmark read latency from API Worker        |
| Frontend                    | **Workers Static Assets** with SPA mode                                                     | Low        | Deploy Vite build, verify client-side routing |
| WebSockets (if needed)      | **Durable Objects** (Hibernation API)                                                       | Medium     | Only if CCXT Pro / live WS feeds are required |

### Highest-risk item

**CCXT on Workers.** The September 2025 `node:http` support is a major de-risk, but CCXT is not in the worksonworkers tested set and issue #19125 is still open. **Do not commit to the migration until a working spike demonstrates CCXT loading and fetching tickers from Binance, Bybit, and OKX in a deployed Worker.** If the spike fails, Option B (direct fetch) is the safe fallback and is arguably simpler given only 3 exchanges are in use.

---

## Sources (all fetched 2026-06-17)

- CCXT issue: https://github.com/ccxt/ccxt/issues/19125 (open)
- CCXT proxy issue: https://github.com/ccxt/ccxt/issues/25486
- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare node:http docs: https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/
- Cloudflare nodejs compat blog: https://blog.cloudflare.com/nodejs-workers-2025/
- Cloudflare HTTP servers blog: https://blog.cloudflare.com/bringing-node-js-http-servers-to-cloudflare-workers/
- Cloudflare Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare Durable Objects Alarms: https://developers.cloudflare.com/durable-objects/api/alarms/
- Cloudflare Hyperdrive Postgres: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/
- Cloudflare Workers Static Assets (SPA): https://developers.cloudflare.com/workers/static-assets/routing/single-page-applications/
- Cloudflare React + Vite guide: https://developers.cloudflare.com/workers/framework-guides/web-apps/react/
- Cloudflare Pages to Workers migration: https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
- Works on Workers package DB: https://worksonworkers.southpolesteve.workers.dev/ (ccxt NOT listed)
- Upstash vs KV benchmark: https://upstash.com/blog/edgecaching-benchmark
