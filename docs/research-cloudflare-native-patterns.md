# Research: Cloudflare-Native Patterns for Lazuli Migration

**Date:** 2026-06-17
**Status:** Complete
**Scope:** D1, Durable Objects, Workers Static Assets, Hono, Monorepo structure, Workers Cache API, and Hyperdrive, evaluated for the Lazuli migration from Bun/Elysia + Supabase + Redis.

**Companion docs:** `docs/research-cloudflare-workers-ccxt.md` (CCXT compatibility) and `docs/spike-ccxt-results.md` (working CCXT spike). This document focuses on the data, caching, framework, and deployment-layer decisions that build on those findings.

---

## TL;DR / Recommendations

| Component                                                     | Recommendation                                                                                                          | Why                                                                                                                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live ticker cache + 5s poller**                             | **One SQLite-backed Durable Object** (`TickerCacheDO`) that both polls exchanges on an alarm and serves reads via RPC   | Strongly consistent, co-located compute+storage, sub-millisecond reads, no external dependency. This is the canonical Cloudflare pattern for exactly this use case. |
| **HTTP response caching** (API endpoints)                     | **Workers Cache API** (`caches.default`) with short TTLs                                                                | Free, regional, perfect for "cache this JSON for 2-3 seconds" semantics.                                                                                            |
| **Historical/persistent data** (optional `/data/*` endpoints) | **D1** if migrating fully to Cloudflare, **OR Hyperdrive to Supabase** if keeping Postgres                              | D1 is SQLite (schema rewrite required); Hyperdrive keeps existing Postgres with zero data migration. See Section 1 and Section 7 for the tradeoff.                  |
| **API framework**                                             | **Hono**                                                                                                                | Purpose-built for Workers, near-identical ergonomics to Elysia (routes, middleware, typed bindings), first-class Zod validator, RPC client for end-to-end types.    |
| **Frontend**                                                  | **Workers + Static Assets** with `not_found_handling = "single-page-application"`                                       | Pages is being folded into Workers. One deploy serves the Vite SPA and the API.                                                                                     |
| **Monorepo**                                                  | Keep Turborepo; one `wrangler.jsonc` per Worker app under `apps/`; `packages/shared` imported as a workspace dependency | Works today; wrangler resolves workspace packages at build time.                                                                                                    |
| **Supabase during transition**                                | **Hyperdrive**                                                                                                          | Official Supabase example; connection pooling + query caching; `pg`/`postgres.js`/Drizzle/Kysely all supported. Not needed if fully on D1.                          |

---

## 1. Cloudflare D1 (SQLite-based database)

### 1.1 What D1 is

D1 is Cloudflare's serverless SQL database built on SQLite. Each D1 database is backed by a single Durable Object internally and uses SQLite's query engine. From a Worker it is accessed via a binding (`env.DB`) with zero network hops (the database runs in the same network), giving sub-millisecond query latency for indexed lookups.

### 1.2 Creating and managing D1 databases

```bash
# Create a database
npx wrangler d1 create lazuli-prod
# Outputs the binding config to paste into wrangler.jsonc

# Run a schema file locally
npx wrangler d1 execute lazuli-prod --local --file=./schema.sql

# Run a single command against the remote (production) database
npx wrangler d1 execute lazuli-prod --remote --command="SELECT * FROM tickers LIMIT 5"

# Delete a database
npx wrangler d1 delete lazuli-prod
```

### 1.3 Schema migrations

D1 has a built-in migration system. Wrangler tracks applied migrations in a `d1_migrations` table.

```bash
# Create a new migration file (0001_init.sql appears in migrations/)
npx wrangler d1 migrations create lazuli-prod 0001_init

# List applied/unapplied migrations
npx wrangler d1 migrations list lazuli-prod

# Apply pending migrations (use --remote for production)
npx wrangler d1 migrations apply lazuli-prod --local
npx wrangler d1 migrations apply lazuli-prod --remote
```

`wrangler.jsonc` binding with custom migration directory (supports Drizzle-style nested layouts via `migrations_pattern`):

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "lazuli-prod",
      "database_id": "<UUID>",
      "migrations_dir": "migrations",
    },
  ],
}
```

Equivalent TOML:

```toml
[[d1_databases]]
binding = "DB"
database_name = "lazuli-prod"
database_id = "<UUID>"
migrations_dir = "migrations"
```

### 1.4 Querying D1 from a Worker

The `D1Database` binding exposes a prepared-statement API. This maps cleanly onto the existing Elysia controller pattern:

```ts
export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/v1/tickers/latest') {
      // Prepared statement with bound params (prevents SQL injection)
      const { results } = await env.DB.prepare(
        'SELECT * FROM tickers WHERE symbol = ? ORDER BY created_at DESC LIMIT 1'
      )
        .bind('BTC/USDT')
        .run();
      return Response.json(results);
    }

    // Batch multiple statements in one round trip
    const results = await env.DB.batch([
      env.DB.prepare('INSERT INTO tickers (symbol, last) VALUES (?, ?)').bind('BTC/USDT', 66000),
      env.DB.prepare('SELECT COUNT(*) as count FROM tickers'),
    ]);

    return Response.json(results);
  },
} satisfies ExportedHandler<Env>;
```

Every query result includes a `meta` object with `rows_read` and `rows_written`, which is what D1 bills on. Use this to monitor cost:

```json
"meta": {
  "duration": 0.2,
  "rows_read": 5000,
  "rows_written": 0
}
```

### 1.5 D1 limits

| Feature                                 | Workers Free | Workers Paid |
| --------------------------------------- | ------------ | ------------ |
| Databases per account                   | 10           | 50,000       |
| Max database size                       | 500 MB       | **10 GB**    |
| Storage per account                     | 5 GB         | 1 TB         |
| Queries per Worker invocation           | 50           | 1,000        |
| Max columns per table                   | 100          | 100          |
| Max row/BLOB size                       | 2 MB         | 2 MB         |
| Max SQL statement length                | 100 KB       | 100 KB       |
| Max bound parameters per query          | 100          | 100          |
| Max query duration                      | 30s          | 30s          |
| Simultaneous connections per invocation | 6            | 6            |
| Time Travel (PITR)                      | 7 days       | 30 days      |

**Concurrency model (critical for Lazuli):** Each D1 database is single-threaded. Throughput is governed by query duration: ~1 ms queries give ~1,000 QPS; ~100 ms queries give ~10 QPS. If the queue fills, D1 returns an "overloaded" error. For a write-heavy ticker store being polled every 5 seconds across 3 exchanges, this is fine, but a read-replica topology (D1 supports read replication at no extra cost) should be considered if API read traffic spikes.

### 1.6 D1 vs Supabase Postgres: SQL feature differences

This is the key migration-risk area. The existing `database-setup.sql` uses PostgreSQL features that D1/SQLite does **not** support as-is.

| Postgres feature in `database-setup.sql`                         | D1 / SQLite equivalent                                                                                                                                              | Migration action                                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BIGSERIAL PRIMARY KEY`                                          | `INTEGER PRIMARY KEY` (SQLite auto-increments `INTEGER PRIMARY KEY` columns via an implicit rowid)                                                                  | Replace `BIGSERIAL` with `INTEGER PRIMARY KEY`                                                                                                                    |
| `DECIMAL(20,8)`                                                  | SQLite has no native DECIMAL type; it stores as `REAL` (IEEE 754 double) or `TEXT`. `DECIMAL` is accepted as a type affinity hint but math is float-based.          | Store prices as `REAL`, or as `TEXT` and parse in JS. For trading data, prefer storing integer micros (e.g., satoshi) in `INTEGER` to avoid float precision loss. |
| `VARCHAR(50)`                                                    | SQLite ignores length on `VARCHAR(n)` (type affinity only)                                                                                                          | No change needed; lengths are advisory                                                                                                                            |
| `TIMESTAMP WITH TIME ZONE DEFAULT NOW()`                         | SQLite has no datetime type. Store as `INTEGER` (unix ms) or `TEXT` (ISO 8601). `DEFAULT` must use a literal or `CURRENT_TIMESTAMP` / `(strftime('%s','now'))`      | Replace with `created_at INTEGER DEFAULT (unixepoch())` or store ISO strings                                                                                      |
| `CREATE OR REPLACE FUNCTION ... RETURNS TRIGGER` (plpgsql)       | SQLite triggers use inline SQL, not a function language. No `CREATE FUNCTION`.                                                                                      | See converted trigger below                                                                                                                                       |
| `CREATE TRIGGER ... EXECUTE FUNCTION ...`                        | `CREATE TRIGGER ... BEFORE UPDATE ON ... FOR EACH ROW BEGIN UPDATE ... SET updated_at = ...; END;`                                                                  | Rewrite as inline SQL trigger                                                                                                                                     |
| Row Level Security (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) | **Not supported.** D1 has no RLS.                                                                                                                                   | Enforce access control in the Worker (the binding is already the only access path)                                                                                |
| `CREATE POLICY ...`                                              | **Not supported.**                                                                                                                                                  | Same as above, handle in application code                                                                                                                         |
| `CREATE OR REPLACE VIEW ... DISTINCT ON (...)`                   | `CREATE VIEW` is supported, but `DISTINCT ON` is a Postgres extension. SQLite supports `DISTINCT` and window functions (`ROW_NUMBER() OVER (...)`) as a replacement | Rewrite the `latest_tickers` view using a window function                                                                                                         |
| `CHECK (type IN ('spot', 'perp'))`                               | **Supported.** SQLite enforces CHECK constraints (toggle with `PRAGMA ignore_check_constraints`)                                                                    | No change needed                                                                                                                                                  |
| `auth.role()`                                                    | Not applicable (no RLS)                                                                                                                                             | Remove                                                                                                                                                            |

**Converted `database-setup.sql` for D1 (key tables):**

```sql
-- tickers: INTEGER PK auto-increments; timestamps as unix-epoch integers
CREATE TABLE IF NOT EXISTS tickers (
  id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('spot', 'perp')),
  bid REAL,
  ask REAL,
  last REAL,
  high24h REAL,
  low24h REAL,
  volume24h REAL,
  quote_volume24h REAL,
  change24h REAL,
  percentage24h REAL,
  funding_rate REAL,
  open_interest REAL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tickers_symbol_exchange_time
ON tickers (symbol, exchange, created_at DESC);

-- markets: TEXT primary key instead of VARCHAR
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('spot', 'perp')),
  active INTEGER DEFAULT 1,   -- SQLite uses 0/1 for booleans
  exchange TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(symbol, exchange, type)
);

-- SQLite trigger: inline SQL, no function language
CREATE TRIGGER IF NOT EXISTS update_tickers_updated_at
  AFTER UPDATE ON tickers
  FOR EACH ROW
  BEGIN
    UPDATE tickers SET updated_at = unixepoch() WHERE id = NEW.id;
  END;

-- latest_tickers view: replace DISTINCT ON with ROW_NUMBER window
CREATE VIEW IF NOT EXISTS latest_tickers AS
SELECT * FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY symbol, exchange, type ORDER BY created_at DESC) AS rn
  FROM tickers
) WHERE rn = 1;
```

**Note on booleans:** SQLite stores them as 0/1 integers. Queries must use `WHERE active = 1` rather than `WHERE active = true`.

### 1.7 D1 pricing

| Metric       | Free       | Paid                                            |
| ------------ | ---------- | ----------------------------------------------- |
| Rows read    | 5M / day   | 25B / month included, then **$0.001 / million** |
| Rows written | 100K / day | 50M / month included, then **$1.00 / million**  |
| Storage      | 5 GB total | 5 GB included, then **$0.75 / GB-month**        |

**Critical cost warning:** Pricing is per **row scanned**, not per row returned. An unindexed `SELECT *` on a 5-million-row table costs 5 million rows read every time it runs. A community report documented a **$134/month D1 bill** that was cut 95% by adding composite indexes and a KV cache layer. For Lazuli, the `idx_tickers_symbol_exchange_time` index is essential. Avoid full-table scans in the hot path.

### 1.8 Connection model

D1 is **serverless from Workers via bindings**. There is no TCP connection, no driver, no connection string, and no Hyperdrive needed. Hyperdrive is only relevant if you keep Supabase Postgres instead of migrating to D1.

---

## 2. Durable Objects (caching + background polling)

### 2.1 What Durable Objects are

A Durable Object (DO) is a **globally unique, single-threaded** compute instance with its own private, transactional, strongly-consistent storage. Key properties for the Lazuli use case:

- **Singleton semantics:** A DO class + a fixed name (e.g., `env.TICKER_CACHE.idByName("global")`) gives you exactly one instance worldwide. All requests to that name route to the same single-threaded instance.
- **Co-located compute + storage:** The SQLite database lives in the same process as the DO's JavaScript, so reads/writes have no network hop.
- **Alarms API:** A DO can schedule itself to wake up at arbitrary intervals (sub-second granularity possible), which is how the 5-second polling loop works.

### 2.2 Class structure

A DO extends the built-in `DurableObject` class from `cloudflare:workers`. Public methods become RPC methods callable from any Worker via a stub.

```ts
import { DurableObject } from 'cloudflare:workers';

export class TickerCacheDO extends DurableObject<Env> {
  sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Initialize schema on first access. Runs once per instance lifetime.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tickers (
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        type TEXT NOT NULL,
        bid REAL, ask REAL, last REAL,
        volume24h REAL, change24h REAL, percentage24h REAL,
        funding_rate REAL, open_interest REAL,
        updated_at INTEGER,
        PRIMARY KEY (symbol, exchange, type)
      );
    `);
  }
}
```

### 2.3 Alarms API for recurring background work

This is the core of the polling pattern. Each DO can hold **one alarm at a time**. The alarm handler does work, then reschedules itself, creating a self-perpetuating loop.

```ts
export class TickerCacheDO extends DurableObject<Env> {
  // Kick off the polling loop if it isn't already running.
  async ensurePolling(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null) {
      await this.ctx.storage.setAlarm(Date.now() + 5000);
    }
  }

  // The alarm handler. Guaranteed at-least-once execution.
  // Retried with exponential backoff (2s, up to 6 retries) on throw.
  async alarm(): Promise<void> {
    try {
      await this.pollAllExchanges();
    } finally {
      // Always reschedule, regardless of success/failure, so the loop never dies.
      // 5-second interval. Minimum practical granularity is ~1s.
      this.ctx.storage.setAlarm(Date.now() + 5000);
    }
  }

  private async pollAllExchanges(): Promise<void> {
    // CCXT calls (per spike-ccxt-results.md, CCXT works with fetchImplementation: fetch)
    const [binance, bybit, okx] = await Promise.all([
      this.pollExchange('binance'),
      this.pollExchange('bybit'),
      this.pollExchange('okx'),
    ]);

    const now = Date.now();
    // Upsert into the DO's private SQLite. transactionSync wraps this atomically.
    this.ctx.storage.transactionSync(() => {
      for (const ticker of [...binance, ...bybit, ...okx]) {
        this.sql.exec(
          `INSERT OR REPLACE INTO tickers
            (symbol, exchange, type, bid, ask, last, volume24h, change24h, percentage24h, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ticker.symbol,
          ticker.exchange,
          ticker.type,
          ticker.bid,
          ticker.ask,
          ticker.last,
          ticker.volume24h,
          ticker.change,
          ticker.percentage,
          now
        );
      }
    });
  }
}
```

**Alarm guarantees:**

- At-least-once delivery; retried on uncaught exceptions with exponential backoff (2s base, up to 6 retries).
- Alarm handler wall time limit: **15 minutes**. CPU limit: 30s default, configurable to 5 min via `limits.cpu_ms`.
- Only one `alarm()` runs at a time per DO instance.
- If the DO is evicted from memory, the alarm wakes it back up.

### 2.4 Serving cached data via RPC

Workers read the cached tickers by calling RPC methods on the DO stub. This is strongly consistent because the DO is single-threaded and the data lives in its own storage.

```ts
// In the Worker (API layer)
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Singleton DO: fixed name gives one global instance
    const stub = env.TICKER_CACHE.getByName('global');

    // Ensure the polling loop is running
    await stub.ensurePolling();

    const url = new URL(request.url);
    if (url.pathname === '/api/v1/tickers/binance') {
      const tickers = await stub.getTickersByExchange('binance');
      return Response.json(tickers);
    }
    // ...
  },
} satisfies ExportedHandler<Env>;

// In the DO
export class TickerCacheDO extends DurableObject<Env> {
  async getTickersByExchange(exchange: string): Promise<Ticker[]> {
    // Co-located read: sub-millisecond
    return this.sql.exec<Ticker>('SELECT * FROM tickers WHERE exchange = ?', exchange).toArray();
  }

  async getTicker(symbol: string, exchange: string): Promise<Ticker | null> {
    const cursor = this.sql.exec<Ticker>(
      'SELECT * FROM tickers WHERE symbol = ? AND exchange = ?',
      symbol,
      exchange
    );
    const rows = cursor.toArray();
    return rows.length > 0 ? rows[0] : null;
  }
}
```

### 2.5 wrangler.jsonc configuration for DOs

Two pieces: the binding (how the Worker references the DO) and the migration (how the DO class is declared as SQLite-backed).

```jsonc
{
  "name": "lazuli-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-17",
  "compatibility_flags": ["nodejs_compat"],

  "durable_objects": {
    "bindings": [
      {
        "name": "TICKER_CACHE",
        "class_name": "TickerCacheDO",
      },
    ],
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["TickerCacheDO"],
    },
  ],

  "limits": {
    "cpu_ms": 300000,
  },
}
```

Equivalent TOML:

```toml
name = "lazuli-api"
main = "src/index.ts"
compatibility_date = "2026-06-17"
compatibility_flags = ["nodejs_compat"]

[[durable_objects.bindings]]
name = "TICKER_CACHE"
class_name = "TickerCacheDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TickerCacheDO"]

[limits]
cpu_ms = 300000
```

**Important:** `new_sqlite_classes` (not `new_classes`) is what creates a SQLite-backed DO. `new_classes` creates the legacy KV-backed DO which has a 128 KiB value limit and is not recommended for new projects.

### 2.6 Durable Object limits

| Feature                           | Limit                              |
| --------------------------------- | ---------------------------------- |
| Storage per DO                    | **10 GB**                          |
| DO classes per account            | 500 (Paid) / 100 (Free)            |
| Number of object instances        | Unlimited                          |
| Key + value combined size         | 2 MB                               |
| CPU per request/alarm             | 30s default, configurable to 5 min |
| Simultaneous outgoing connections | 6                                  |
| SQL columns per table             | 100                                |
| SQL statement length              | 100 KB                             |
| Bound parameters per query        | 100                                |
| Wall time per alarm invocation    | 15 minutes                         |
| Soft request limit per DO         | ~1,000 req/sec                     |

The 1,000 req/sec soft limit per DO instance is the main scaling ceiling for the singleton pattern. For Lazuli's API serving cached tickers, this is likely sufficient for early traffic. If it becomes a bottleneck, shard by exchange (one DO per exchange) to multiply headroom.

### 2.7 Durable Object pricing

**Compute (duration):** Billed in wall-clock GB-seconds while the DO is active and not hibernating. 128 MB allocated per DO regardless of actual usage.

| Metric                                  | Free              | Paid                                                          |
| --------------------------------------- | ----------------- | ------------------------------------------------------------- |
| Requests (HTTP, RPC, alarm invocations) | 100K / day        | 1M / month included, then **$0.15 / million**                 |
| Duration                                | 13,000 GB-s / day | 400,000 GB-s / month included, then **$12.50 / million GB-s** |

**Storage (SQLite backend, identical to D1 pricing):**

| Metric       | Free       | Paid                                        |
| ------------ | ---------- | ------------------------------------------- |
| Rows read    | 5M / day   | 25B / month included, then $0.001 / million |
| Rows written | 100K / day | 50M / month included, then $1.00 / million  |
| Stored data  | 5 GB total | 5 GB included, then $0.20 / GB-month        |

**Cost estimate for the singleton poller:** Polling every 5 seconds = 17,280 alarm invocations/month (free under the 1M included). If each alarm polls 3 exchanges (~3,000 tickers total) and upserts them, that's ~3,000 rows written per alarm x 17,280 = ~52M rows written/month, which is just over the 50M included (~$2/month for writes). Duration billing depends on how long each alarm stays active; if each alarm takes 2 seconds of wall time, that's 34,560 seconds x 128 MB = ~4,424 GB-s/month (well under the 400,000 included). Total: effectively the $5/month Workers Paid minimum.

**Important RPC billing note:** Each RPC method call on a DO stub is billed as one request. If the API Worker calls `getTickersByExchange` per HTTP request, that's one DO request per API request. Batch reads (return all tickers in one call) to minimize this.

### 2.8 Can one DO serve as both poller AND cache? **Yes, and it's the recommended pattern.**

This is explicitly the use case Durable Objects are designed for. The singleton DO:

1. Polls exchanges on its alarm (write path).
2. Stores results in its private SQLite storage.
3. Serves reads via RPC to API Workers (read path).

Benefits over splitting poller and cache:

- Zero-latency reads (data is in-process).
- Strong consistency (single-threaded, no race between write and read).
- No external dependency (no KV, no Redis, no D1 round-trip).
- One billable component instead of two.

The only reason to split would be if read traffic exceeds the ~1,000 req/sec soft limit of a single DO, in which case shard by exchange.

### 2.9 DO SQLite storage vs D1

Cloudflare's own documentation draws this distinction clearly:

- **D1** is a managed database product. Batteries-included: HTTP API, schema migrations, data import/export, query insights. Application code and database are separate (network hop). Good for the "familiar app-server talks to database" architecture.
- **DO SQLite** is a lower-level compute-with-storage building block. You write both the frontend Worker (routing) and the DO (logic + storage). More effort, but co-located compute+storage and full control. No built-in migrations or HTTP API.

SQL pricing and limits are intentionally identical between the two. **For Lazuli's live ticker cache, DO SQLite is the right choice** (co-located with the poller, strongly consistent). **For historical/persistent data accessed via SQL from the API Worker, D1 is simpler** (migrations, dashboard, no DO RPC hop).

---

## 3. Workers with Static Assets (React SPA)

### 3.1 Current state

Cloudflare Pages is being folded into Workers. The strategic product is **Workers + Static Assets**. New projects should use Workers Static Assets, not Pages.

### 3.2 SPA configuration

The Vite build output (`dist/`) is served as static assets, with SPA fallback so client-side routing works:

```jsonc
{
  "name": "lazuli-web",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-17",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application",
    "binding": "ASSETS",
  },
}
```

Equivalent TOML:

```toml
name = "lazuli-web"
main = "src/index.ts"
compatibility_date = "2026-06-17"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
binding = "ASSETS"
```

`not_found_handling = "single-page-application"` means any request that doesn't match a static file returns `200 OK` with `index.html`, so React Router handles the route.

### 3.3 Combining static assets with API routes

By default, Cloudflare serves a matching static asset first. If no asset matches, the Worker script runs. This lets one Worker serve both the SPA and the API:

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // API routes hit the Worker (no matching static asset)
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env);
    }

    // Everything else: defer to static assets (SPA fallback applies)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

### 3.4 `run_worker_first` for selective control

If you need the Worker to run before serving assets (e.g., for auth checks or API routes that might collide with asset paths), use `run_worker_first`:

```jsonc
{
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"],
  },
}
```

With this config, `/api/*` always hits the Worker first; all other paths try assets first, then the SPA fallback. This is the cleanest setup for Lazuli: the API is always handled by code, and the SPA is served from the CDN.

### 3.5 Routing summary

| Request path               | Behavior                                                  |
| -------------------------- | --------------------------------------------------------- |
| `/assets/index-abc123.js`  | Static asset served from CDN (no Worker invocation)       |
| `/tickers` (no file match) | `index.html` returned (SPA mode), React Router handles it |
| `/api/v1/tickers/binance`  | Worker runs (via `run_worker_first`), serves JSON         |

### 3.6 Caching behavior

Static assets are automatically cached on Cloudflare's global network. First request fetches from storage; subsequent requests hit the nearest cache. Tiered caching improves hit ratio. No configuration needed.

---

## 4. Hono Framework

### 4.1 Why Hono

Hono is the recommended web framework for Cloudflare Workers. It is built on Web Standards (Fetch API, WinterCG), runs on Workers/Bun/Deno/Node, and is the closest analog to Elysia in the Workers ecosystem.

### 4.2 Setup

```bash
# Using bun (Lazuli's existing runtime)
bun add hono
bun add -d @cloudflare/workers-types
```

### 4.3 Basic app with routing

```ts
import { Hono } from 'hono';

// Bindings and variables are typed via generics
type Bindings = {
  DB: D1Database;
  TICKER_CACHE: DurableObjectNamespace;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// Route with path parameter
app.get('/api/v1/tickers/:exchange/:symbol', async (c) => {
  const { exchange, symbol } = c.req.param();
  const stub = c.env.TICKER_CACHE.getByName('global');
  const ticker = await stub.getTicker(symbol, exchange);
  if (!ticker) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true, data: ticker, timestamp: Date.now() });
});

// Route with query params
app.get('/api/v1/tickers/:exchange', async (c) => {
  const exchange = c.req.param('exchange');
  const type = c.req.query('type') ?? 'spot';
  const stub = c.env.TICKER_CACHE.getByName('global');
  const tickers = await stub.getTickersByExchange(exchange);
  return c.json({ success: true, data: tickers, timestamp: Date.now() });
});

export default app;
```

### 4.4 Middleware

Hono middleware is functions that call `next()`:

```ts
import { logger, poweredBy } from 'hono/logger';

app.use('*', logger());
app.use('*', poweredBy());

// Custom middleware: request timing
app.use('/api/*', async (c, next) => {
  const start = Date.now();
  await next();
  c.header('X-Response-Time', `${Date.now() - start}ms`);
});

// Error handling
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ success: false, data: null, error: err.message, timestamp: Date.now() }, 500);
});

// 404 handler
app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
```

### 4.5 CORS

```ts
import { cors } from 'hono/cors';

app.use(
  '/api/*',
  cors({
    origin: ['https://lazuli.example.com', 'http://localhost:5173'],
    allowMethods: ['GET', 'POST', 'DELETE'],
    allowHeaders: ['Content-Type', 'X-API-Key'],
    maxAge: 86400,
  })
);
```

### 4.6 Hono + Zod for validation

Hono has a built-in Zod validator middleware that infers types from the schema, mirroring Elysia's pattern:

```ts
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// Validate query params
const TickerQuerySchema = z.object({
  type: z.enum(['spot', 'perp']).default('spot'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

app.get(
  '/api/v1/tickers/:exchange',
  zValidator('query', TickerQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: result.error.issues }, 400);
    }
  }),
  async (c) => {
    // result.data is fully typed: { type: "spot" | "perp", limit: number }
    const { type, limit } = c.req.valid('query');
    const exchange = c.req.param('exchange');
    // ...
  }
);

// Validate JSON body for POST endpoints
const StoreDataSchema = z.object({
  symbol: z.string(),
  exchange: z.string(),
  last: z.number(),
});

app.post('/api/v1/data/store/:exchange', zValidator('json', StoreDataSchema), async (c) => {
  const data = c.req.valid('json'); // typed as { symbol: string, ... }
  // ...
});
```

### 4.7 Hono RPC client (end-to-end types)

Hono generates a typed client from the server's route definitions, similar to Elysia's Eden Treaty:

```ts
// Server: export the app type
import { Hono } from 'hono';
const app = new Hono(); /*.routes...*/
export default app;
export type AppType = typeof app;

// Client (in the web app):
import { hc } from 'hono/client';
import type { AppType } from '../api/src/index';

const client = hc<AppType>('/');

// Fully typed: symbol is typed as the route param, response is typed
const res = await client.api.v1.tickers[':exchange'][':symbol'].$get({
  param: { exchange: 'binance', symbol: 'BTC/USDT' },
});
const data = await res.json(); // typed
```

### 4.8 Hono vs Elysia comparison

| Feature        | Elysia (Bun)                               | Hono (Workers)                           |
| -------------- | ------------------------------------------ | ---------------------------------------- |
| Runtime        | Bun (primary)                              | Workers, Bun, Deno, Node, Vercel         |
| Type safety    | Via `@elysiajs/` plugins and Eden Treaty   | Via `zValidator` + `hono/client` RPC     |
| Validation     | Built-in (`t.Body()`, `t.Query()`)         | Zod via `@hono/zod-validator`            |
| Performance    | ~200K+ req/s on Bun                        | ~Fastest on Workers (built for it)       |
| Middleware     | `.use()`, `.on()`, lifecycle hooks         | `.use()`, simple function chains         |
| Pattern        | `new Elysia().get(path, handler, options)` | `new Hono().get(path, handler)`          |
| Error handling | `.error()`, `error()` hook                 | `app.onError()`                          |
| Bindings       | N/A (Bun native)                           | `c.env.BINDING_NAME` (typed via generic) |
| Maturity       | Excellent on Bun                           | Excellent on Workers                     |

**Migration effort:** Low. The route handler shape (`(c) => c.json(...)`) is nearly identical. The main differences are: (1) validation moves from Elysia's built-in schema to Zod, (2) `c.env` replaces Bun's `process.env`, and (3) the Hono RPC client replaces Eden Treaty. The Lazuli controller layer translates almost line-for-line.

### 4.9 Hono with other event handlers

Hono integrates cleanly with Workers' module syntax for non-fetch handlers:

```ts
const app = new Hono();
// ... routes ...

export default {
  fetch: app.fetch,
  // Cron trigger handler (if needed for >1min scheduled work)
  scheduled: async (event, env, ctx) => {
    // e.g., daily cleanup of old D1 rows
  },
};
```

---

## 5. Monorepo Structure for Cloudflare Workers

### 5.1 Turborepo + Workers layout

The existing Turborepo structure maps cleanly. Each Worker app gets its own `wrangler.jsonc`. The shared package is imported as a workspace dependency.

```
lazuli/
├── apps/
│   ├── api/                    # Hono API Worker (was Elysia)
│   │   ├── src/
│   │   │   ├── index.ts        # Hono app + DO definitions
│   │   │   ├── routes/         # Route handlers
│   │   │   └── do/             # Durable Object classes
│   │   ├── migrations/         # D1 migrations (if using D1)
│   │   ├── wrangler.jsonc      # API Worker config
│   │   └── package.json
│   └── web/                    # React + Vite SPA
│       ├── src/
│       ├── dist/               # Vite build output (referenced by wrangler assets)
│       ├── wrangler.jsonc      # Web Worker config (static assets)
│       └── package.json
├── packages/
│   └── shared/                 # @lazuli/shared - types and utilities
│       ├── src/
│       │   ├── types.ts        # Ticker, Market, etc. types
│       │   └── index.ts
│       └── package.json
├── turbo.json
└── package.json
```

### 5.2 Shared package import

`@lazuli/shared` is imported by Workers exactly like any other npm dependency. Wrangler (via esbuild) resolves workspace packages at build time. No special configuration needed.

```jsonc
// apps/api/wrangler.jsonc
{
  "name": "lazuli-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-17",
  "compatibility_flags": ["nodejs_compat"],
  // No special config needed for @lazuli/shared; it's resolved via package.json
}
```

```ts
// apps/api/src/index.ts
import { Hono } from 'hono';
import type { Ticker, Market } from '@lazuli/shared'; // workspace import works

const app = new Hono();
app.get('/api/v1/tickers/:exchange', async (c) => {
  const tickers: Ticker[] = await getTickers(c.env, c.req.param('exchange'));
  return c.json(tickers);
});
```

### 5.3 Build tooling: wrangler vs bun build

**wrangler is the build tool for Workers.** It uses esbuild internally to bundle the Worker (and its dependencies, including `@lazuli/shared`) into a single artifact. You do **not** use `bun build` for the Worker itself.

For the web app, Vite builds the SPA to `dist/`, and wrangler deploys `dist/` as static assets. The turbo pipeline:

```jsonc
// turbo.json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".wrangler/**"],
    },
    "dev": {
      "cache": false,
      "persistent": true,
    },
    "deploy": {
      "dependsOn": ["build"],
      "cache": false,
    },
  },
}
```

```jsonc
// apps/api/package.json
{
  "name": "@lazuli/api",
  "scripts": {
    "dev": "wrangler dev",
    "build": "wrangler deploy --dry-run",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
  },
  "dependencies": {
    "hono": "^4",
    "@lazuli/shared": "workspace:*",
    "ccxt": "^4.5",
    "protobufjs": "^8",
  },
  "devDependencies": {
    "wrangler": "^4",
    "@cloudflare/workers-types": "^4",
  },
}
```

### 5.4 wrangler.jsonc vs wrangler.toml

Both are supported. Cloudflare's newer templates default to **`wrangler.jsonc`** (JSON with comments), which is better for IDE support and inline documentation. The existing Lazuli spike used `wrangler.toml`. Either works; `jsonc` is recommended for new projects. All examples in this doc show both formats.

### 5.5 Multiple Workers from one monorepo

Each Worker deploys independently with `wrangler deploy` run from its own directory. Turborepo's `dependsOn: ["^build"]` ensures `@lazuli/shared` is built before the Workers that consume it. Workers Builds (Cloudflare's CI) also supports monorepos natively.

---

## 6. Workers Cache API

### 6.1 What it is

The Cache API (`caches.default`) provides HTTP-cache semantics backed by Cloudflare's CDN cache. It is the right tool for caching **HTTP responses** (e.g., "cache this JSON payload for 3 seconds").

### 6.2 TTL-based caching pattern

```ts
// Cache API: cache the full HTTP response for a few seconds
app.get('/api/v1/tickers/:exchange', async (c) => {
  const cache = caches.default;
  const cacheKey = new Request(c.req.url, c.req.raw);

  // Check cache first
  let response = await cache.match(cacheKey);
  if (response) {
    return response; // Cache hit: no DO call, no exchange poll
  }

  // Cache miss: fetch from DO
  const stub = c.env.TICKER_CACHE.getByName('global');
  const tickers = await stub.getTickersByExchange(c.req.param('exchange'));

  response = c.json({
    success: true,
    data: tickers,
    timestamp: Date.now(),
  });

  // Set TTL via Cache-Control header, then put into cache
  // Must clone the response before returning (body can only be consumed once)
  const cachedResponse = response.clone();
  cachedResponse.headers.set('Cache-Control', 'public, max-age=3');
  // Cache API requires the request method to be GET
  c.executionCtx.waitUntil(cache.put(cacheKey, cachedResponse));

  return response;
});
```

### 6.3 Important Cache API behaviors

- **Regional, not global.** Cache contents do not replicate outside the originating data center. A response cached in Frankfurt won't be in Singapore until explicitly created there. This is fine for short-TTL caches but means cache hit rate depends on geographic request distribution.
- **Only works on custom domains** (not `*.workers.dev` previews or the dashboard editor).
- **Respects HTTP headers** on the response passed to `put()`: `Cache-Control`, `ETag`, `Expires`, `Last-Modified`. The `max-age` directive sets the TTL.
- **`put()` requires GET method** in the request; throws on non-GET.
- **Max object size:** 512 MB.
- **Limits:** 50 cache ops per request (Free), 1,000 (Paid).

### 6.4 Cache API vs Durable Object storage: when to use which

| Criterion          | Workers Cache API                              | Durable Object Storage                       |
| ------------------ | ---------------------------------------------- | -------------------------------------------- |
| **What it caches** | HTTP responses (full `Response` objects)       | Structured data (SQL rows, key-value)        |
| **Consistency**    | Regional, eventually consistent                | Strongly consistent (single-threaded per DO) |
| **TTL**            | Via `Cache-Control` header                     | Manual (delete or overwrite)                 |
| **Querying**       | By URL key only                                | SQL queries, key prefix scans                |
| **Cost**           | Free                                           | Rows read/written + storage                  |
| **Best for**       | Caching API endpoint responses for 2-5 seconds | Authoritative store of live ticker data      |

**Recommendation for Lazuli:** Use **both**. The DO holds the authoritative live data (written by the poller). The Cache API sits in front of the API endpoints, serving cached HTTP responses for 2-3 seconds to absorb read spikes without hitting the DO. This reduces DO RPC calls (and thus DO request billing) significantly.

### 6.5 What NOT to use Cache API for

- Data that must be globally consistent immediately (use DO storage).
- Data that needs to survive more than the CDN TTL (use D1 or DO storage).
- Non-HTTP data (use KV or DO key-value storage).

---

## 7. Hyperdrive (Supabase during transition)

### 7.1 What Hyperdrive is

Hyperdrive provides **connection pooling + query caching** for existing Postgres/MySQL databases from Workers. It maintains a pool of persistent connections to your database within Cloudflare's network, eliminating the 7-round-trip connection setup (TCP, TLS, auth) on every request. It also caches read query results at the edge.

### 7.2 Do you need it?

- **If migrating fully to D1:** No. D1 is accessed via bindings with no connection pooling needed.
- **If keeping Supabase Postgres:** **Yes.** Hyperdrive is the only supported way to connect Workers to Postgres efficiently. Without it, every Worker request would open a new TCP+TLS connection to Supabase (~200ms+ overhead).

### 7.3 Creating a Hyperdrive config for Supabase

```bash
# Create the Hyperdrive config pointing at Supabase
# Use the Supabase pooler connection string (port 6543) for best results
npx wrangler hyperdrive create lazuli-supabase \
  --connection-string="postgres://user:password@db.xxxxx.supabase.co:6543/postgres"
```

This outputs:

```json
{
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "<example id: 57b7076f58be42419276f058a8968187>"
    }
  ]
}
```

### 7.4 wrangler.jsonc configuration

```jsonc
{
  "name": "lazuli-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-17",
  "compatibility_flags": ["nodejs_compat"],

  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "<YOUR_HYPERDRIVE_ID>",
      "localConnectionString": "postgres://user:password@localhost:5432/postgres",
    },
  ],
}
```

Equivalent TOML:

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<YOUR_HYPERDRIVE_ID>"
localConnectionString = "postgres://user:password@localhost:5432/postgres"
```

`localConnectionString` is used during `wrangler dev` to connect to a local Postgres instead of the remote Supabase.

### 7.5 Querying Supabase via Hyperdrive (using `pg`)

```ts
import { Client } from 'pg';

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Create a client per request. Hyperdrive maintains the real pool,
    // so this is fast (no TCP/TLS handshake).
    const client = new Client({
      connectionString: env.HYPERDRIVE.connectionString,
    });

    try {
      await client.connect();
      const result = await client.query(
        'SELECT * FROM tickers WHERE symbol = $1 ORDER BY created_at DESC LIMIT 1',
        ['BTC/USDT']
      );
      return Response.json(result.rows);
    } finally {
      await client.end();
    }
  },
} satisfies ExportedHandler<Env>;
```

### 7.6 Supported drivers

Hyperdrive works with: `pg` (>= 8.16.3), `postgres.js` (>= 3.4.5), Drizzle ORM (>= 0.26.2), Kysely (>= 0.26.3). Requires `nodejs_compat` + compatibility date >= `2024-09-23`.

### 7.7 Query caching

Hyperdrive automatically caches **read queries** (SELECT) at the edge. This is valuable for Lazuli's `/data/latest` and `/data/history` endpoints, which read relatively static historical data. Write queries bypass the cache. Cache invalidation is time-based (configurable, default varies by query pattern).

### 7.8 Hyperdrive for the transition strategy

If Lazuli adopts a phased migration:

1. **Phase 1:** Move API + frontend to Workers, keep Supabase via Hyperdrive. Zero data migration.
2. **Phase 2 (optional):** Migrate historical data tables to D1 if the SQLite schema conversion (Section 1.6) is acceptable, or keep Supabase indefinitely.

Hyperdrive makes Phase 1 low-risk because the existing Postgres schema (triggers, RLS, views, BIGSERIAL) all continue to work unchanged. D1 migration is only pursued if the team wants to fully exit Supabase.

---

## 8. Migration Decision Matrix

| Question                               | Answer                                                   | Recommendation                                       |
| -------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Where do live tickers live?            | In-memory + SQLite of a singleton Durable Object         | `TickerCacheDO` with alarm-based 5s polling          |
| How do API Workers read live data?     | RPC call to the DO                                       | `env.TICKER_CACHE.getByName("global").getTickers()`  |
| How to reduce DO RPC calls under load? | Cache API in front of endpoints                          | `caches.default` with 2-3s TTL                       |
| Where does historical data live?       | D1 (full Cloudflare) or Supabase via Hyperdrive (phased) | Start with Hyperdrive; migrate to D1 if desired      |
| What framework replaces Elysia?        | Hono                                                     | Near-identical API; Zod replaces built-in validation |
| How to serve the React SPA?            | Workers Static Assets                                    | `not_found_handling: "single-page-application"`      |
| How to structure the monorepo?         | Keep Turborepo; one wrangler.jsonc per app               | `@lazuli/shared` resolves as workspace dep           |
| Do we need Redis?                      | No                                                       | DO storage (live) + Cache API (HTTP) replaces it     |
| Do we need Hyperdrive?                 | Only if keeping Supabase                                 | Not needed if fully on D1                            |

---

## Sources (all fetched 2026-06-17)

### D1

- Getting started: https://developers.cloudflare.com/d1/get-started/
- Migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Limits: https://developers.cloudflare.com/d1/platform/limits/
- Pricing: https://developers.cloudflare.com/d1/platform/pricing/
- SQL statements: https://developers.cloudflare.com/d1/sql-api/sql-statements/
- Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/

### Durable Objects

- Overview: https://developers.cloudflare.com/durable-objects/
- Getting started: https://developers.cloudflare.com/durable-objects/get-started/
- SQLite storage API: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Alarms API: https://developers.cloudflare.com/durable-objects/api/alarms/
- Access storage: https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- Invoke methods (RPC): https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/
- Limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/

### Workers Static Assets

- Overview: https://developers.cloudflare.com/workers/static-assets/
- Worker script routing: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- SPA routing: https://developers.cloudflare.com/workers/static-assets/routing/single-page-applications/

### Hono

- Cloudflare Workers guide: https://hono.dev/docs/getting-started/cloudflare-workers
- Validation: https://hono.dev/docs/guides/validation
- CORS: https://hono.dev/docs/middleware/builtin/cors

### Cache API

- Cache: https://developers.cloudflare.com/workers/runtime-apis/cache/

### Hyperdrive

- Getting started: https://developers.cloudflare.com/hyperdrive/get-started/
- Connect to PostgreSQL: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/
- Supabase integration: https://developers.cloudflare.com/workers/databases/third-party-integrations/supabase/
