# Stack Research

**Domain:** Edge-native crypto market intelligence platform (real-time liquidations, derivatives analytics, push alerts)
**Researched:** 2026-07-11
**Confidence:** HIGH — stack is already deployed and in use; this documents the live reality, not a recommendation from scratch

---

## Recommended Stack

This is not a greenfield recommendation — the stack is locked by architectural constraints and already deployed. The entries below document what is in use, why each choice is correct for this domain, and what version to target going forward.

### Core Infrastructure (Cloudflare Platform)

| Technology                  | Version                    | Purpose                                                                  | Why Correct                                                                                                                                            |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare Workers          | Runtime (workerd)          | Edge compute for all API and WS traffic                                  | Sub-millisecond cold starts, globally distributed, 0 egress cost between Workers and D1/R2; the latency moat vs Coinglass is architectural             |
| Durable Objects             | `new_sqlite_classes` mode  | Stateful singletons — MarketDataCacheV2DO, RealtimeHubV2DO               | Only primitive that gives you consistent in-memory state at the edge without an external broker; WebSocket hibernation API prevents billing while idle |
| Cloudflare D1               | SQLite on edge             | Metadata, control-plane, accounts, alerts, signal configs                | Co-located reads are ~1ms; additive-only migrations enforced by project constraint                                                                     |
| Cloudflare R2               | S3-compatible object store | OHLCV archive (top-50 pairs)                                             | Zero egress fees from Workers; append-only OHLCV blobs written by Backfill Workflow                                                                    |
| Cloudflare Queues           | Managed message queue      | Backfill job fan-out, DLQ                                                | At-least-once delivery with DLQ; `max_batch_size=10`, `max_retries=5` is the current tuning                                                            |
| Cloudflare Workflows        | Durable execution          | BackfillWorkflow — orchestrates exchange fetches with up to 25,000 steps | Survives Worker restarts; eliminates the need for a cron scheduler or external job queue                                                               |
| Cloudflare Analytics Engine | Time-series append-only    | KPI instrumentation (alert subscribers, WS connections, latency p95)     | Free within Workers plan, no separate InfluxDB/DataDog needed, queryable via SQL API                                                                   |
| Cloudflare Rate Limiting    | Built-in                   | 6 named limiters (public, expensive, builder, exchange, admin)           | No external Redis rate-limit store; limits enforced at the edge before compute                                                                         |
| Workers Static Assets       | Edge-served SPA            | Serves the React/Vite web app                                            | Replaces a CDN + origin setup; assets served from Cloudflare's backbone                                                                                |

### API Layer

| Technology          | Version  | Purpose                              | Why Correct                                                                                                                                       |
| ------------------- | -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hono                | ^4.12.26 | HTTP framework on Workers            | Ultra-thin, Workers-native, ~14kB; built-in middleware, routing, and validator helpers; the only framework with first-class Cloudflare env typing |
| @hono/zod-validator | ^0.8.0   | Request validation middleware        | Pairs with Zod for schema-first validation on every route                                                                                         |
| Zod                 | ^4.4.3   | Schema validation and type inference | v4 is a complete rewrite with faster parse performance; use `z.object()` for all request/response shapes                                          |

### Data Access Layer

| Technology             | Version | Purpose                                                       | Why Correct                                                                                                                                                     |
| ---------------------- | ------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CCXT                   | ^4.5.59 | Exchange API client (Binance, Bybit, OKX, Hyperliquid, Upbit) | Unified API across 100+ exchanges; handles auth, rate limits, and response normalization; only library that covers all 5 target exchanges under one abstraction |
| @simplewebauthn/server | ^13.3.2 | Passkey / WebAuthn server-side verification                   | Eliminates password storage; used for D1 magic-link/passkey auth track                                                                                          |
| protobufjs             | ^8.6.4  | Protocol Buffers decoding                                     | Needed to decode exchange WebSocket feeds that use protobuf framing (Binance futures)                                                                           |

### Frontend

| Technology         | Version     | Purpose                        | Why Correct                                                                                                                            |
| ------------------ | ----------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| React              | ^18.3.1     | UI framework                   | Stable, no reason to migrate; concurrent features available for the real-time update path                                              |
| Vite               | ^6.4.3      | Build tool                     | Fastest HMR for local dev; builds optimized bundles for Workers Static Assets                                                          |
| TanStack Query     | ^5.101.0    | Server state and cache         | Handles stale-while-revalidate for REST polling; deduplication prevents thundering-herd on ticker refreshes                            |
| React Router DOM   | ^7.18.0     | Client-side routing            | v7 is framework-grade with loader/action model; use for route-level data fetching on SEO pages (D6)                                    |
| TailwindCSS        | ^4.3.1      | Utility-first CSS              | v4 (Oxide engine) is significantly faster at build time than v3; zero-config with Vite via `@tailwindcss/postcss`                      |
| Radix UI           | ^2.x / ^1.x | Headless accessible components | Dialog, DropdownMenu, Tabs, Select, Popover, Slider, Tooltip — all in use; composable primitives without style lock-in                 |
| lightweight-charts | ^4.2.3      | Financial charting             | TradingView's chart library, purpose-built for OHLCV candlestick and overlay rendering; no viable alternative at this performance tier |
| Framer Motion      | ^12.40.0    | Animation                      | Used for dashboard transitions and heatmap overlays; v12 has improved layout animation performance                                     |
| nuqs               | ^2.8.9      | URL search param state         | Encodes workspace state into URL for shareable snapshots (D3 dependency); type-safe with Zod                                           |
| cmdk               | ^1.1.1      | Command palette                | Used for symbol/exchange search UI                                                                                                     |
| sonner             | ^2.0.7      | Toast notifications            | Lightweight; handles alert delivery confirmations                                                                                      |
| lucide-react       | ^0.552.0    | Icon library                   | Tree-shakeable; standard choice with Radix UI ecosystem                                                                                |

### Development Toolchain

| Tool                | Version      | Purpose                         | Notes                                                                                                                     |
| ------------------- | ------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Bun                 | ^1.1.38      | Package manager + local runtime | `packageManager` field set; do not switch to npm/yarn/pnpm — Bun's workspace resolution is the project standard           |
| Turborepo           | ^2.9.18      | Monorepo task orchestration     | `turbo run dev/build/lint` with cache; task graph defined in `turbo.json`                                                 |
| Wrangler            | ^4.103.0     | Cloudflare Workers CLI          | Deploys, local dev with miniflare, D1 migrations, secret management; `wrangler.jsonc` is the source of truth for bindings |
| TypeScript          | ^5.9.3       | Type checking                   | Strict mode; `wrangler types` generates binding types before `tsc --noEmit`                                               |
| ESLint              | ^9.39.4      | Linting                         | Flat config (`eslint.config.js`); `--max-warnings 0` enforced in CI                                                       |
| Prettier            | ^3.8.4       | Formatting                      | Runs on all `ts,tsx,js,jsx,json,md`; checked in lint-staged                                                               |
| Husky + lint-staged | ^9.x / ^15.x | Pre-commit hooks                | Runs ESLint fix + Prettier on changed files before commit                                                                 |
| commitlint          | ^19.x        | Commit message enforcement      | Conventional commits enforced                                                                                             |

---

## Installation

```bash
# Install all workspace dependencies
bun install

# Add a dependency to the API worker
bun add <package> --filter @lazuli/api

# Add a dependency to the web app
bun add <package> --filter @lazuli/web

# Run local dev (both workers)
bun run dev

# Deploy to staging
bun run build:api && cd apps/api && wrangler deploy --env staging

# Apply D1 migrations (staging)
cd apps/api && wrangler d1 migrations apply lazuli-db-staging --env staging --remote
```

---

## Alternatives Considered

| Category              | In Use                                 | Alternative                                   | Why Alternative Is Wrong Here                                                                                                                                         |
| --------------------- | -------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge runtime          | Cloudflare Workers                     | Vercel Edge / Deno Deploy                     | Vercel has no Durable Objects equivalent; Deno Deploy lacks Queues/Workflows; both would require an external broker for pub/sub, adding latency and egress cost       |
| WebSocket broker      | Durable Objects (RealtimeHubV2DO)      | Ably / Pusher / Upstash                       | External brokers add ~50–200ms RTT and egress billing; Durable Objects with hibernation are free while idle and co-located with the Worker                            |
| Database              | D1 (SQLite at edge)                    | PlanetScale / Neon / Supabase                 | All of these require a TCP round-trip to a non-edge data center; D1 reads are ~1ms from Workers; additive-only constraint also fits SQLite's migration story          |
| Object storage        | R2                                     | S3 / GCS                                      | R2 has zero egress fees from Workers; S3 egress to Cloudflare PoPs would cost ~$0.09/GB and accumulate fast on OHLCV archive reads                                    |
| API framework         | Hono                                   | Itty Router / Express                         | Itty Router lacks middleware composability; Express does not run on Workers (Node.js APIs); Hono is the only production-grade Workers-native framework                |
| Exchange client       | CCXT                                   | Custom fetch per exchange                     | CCXT saves thousands of lines of exchange-specific normalization code; the only concern is bundle size (mitigated by tree-shaking and the Workers 10MB limit)         |
| Auth                  | Passkey / magic-link (@simplewebauthn) | Password + bcrypt                             | Passwords require secure storage, rotation, breach detection; passkeys are phishing-resistant and add zero COGS; project constraint is explicit: no password database |
| Charts                | lightweight-charts (TradingView)       | Recharts / Victory / Chart.js                 | Recharts and Chart.js are not built for high-frequency financial data; lightweight-charts handles 10K+ candles with sub-frame rendering via Canvas                    |
| CSS                   | Tailwind v4                            | CSS Modules / styled-components / Tailwind v3 | Tailwind v4 (Oxide) is 5–10x faster at build time than v3; CSS Modules add boilerplate; styled-components adds runtime overhead incompatible with SSR edge rendering  |
| Build tool (frontend) | Vite                                   | webpack / esbuild standalone                  | Vite wraps esbuild for dev speed; webpack is slower and requires more config; Vite has first-class Cloudflare Workers Static Assets integration                       |

---

## What NOT to Use

| Avoid                                                        | Why                                                                                                                                       | Use Instead                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Node.js runtime for Workers                                  | Workers run on V8 isolates (workerd), not Node.js; `nodejs_compat` flag bridges select APIs but the runtime is not Node                   | Cloudflare Workers runtime with `nodejs_compat` flag (already set in wrangler.jsonc)             |
| Prisma / Drizzle ORM                                         | Both generate heavy migration tooling and runtime query builders incompatible with D1's additive-only constraint and edge environment     | Raw D1 SQL with TypeScript-typed result rows; migrations are plain `.sql` files in `migrations/` |
| Redis / Upstash                                              | External Redis adds network hops from edge; rate limiting is handled by Cloudflare Rate Limiting; caching is handled by DO in-memory + D1 | Cloudflare Rate Limiting for throttling; Durable Objects for in-memory caching                   |
| Socket.io                                                    | Requires Node.js server and adds 40kB client overhead; incompatible with Workers                                                          | Native WebSocket API on Workers (`new WebSocketPair()`) + DO hibernation                         |
| JWT for auth sessions                                        | JWT requires a shared secret or PKI; stateless by design but hard to revoke; session invalidation needs D1 lookup anyway                  | Magic-link tokens stored in D1 with expiry; passkeys via @simplewebauthn                         |
| `npm` / `yarn` / `pnpm`                                      | `packageManager: "bun@1.1.38"` is set at root; switching breaks workspace resolution and lock file consistency                            | `bun install` / `bun add`                                                                        |
| Stochastic vol models (SABR, Heston)                         | Out of scope until B4 validates demand; complex to implement correctly, high maintenance burden                                           | Black-Scholes on Deribit IV (already decided; E3 task)                                           |
| External cron schedulers (cron-job.org, GitHub Actions cron) | Adds external dependency for a function the Cloudflare platform provides natively                                                         | Cloudflare Cron Triggers in `wrangler.jsonc` `triggers.crons` array                              |
| `dotenv`                                                     | Bun auto-loads `.env`; dotenv is redundant                                                                                                | Nothing — delete any dotenv imports if found                                                     |

---

## Stack Patterns by Variant

**For real-time data paths (A0, A1, A4, B1):**

- Use Durable Objects with WebSocket hibernation API, not polling loops
- Because hibernation zeroes out CPU billing while clients are connected but idle; polling loops burn CPU budget

**For KPI instrumentation (all phases):**

- Use `env.API_ANALYTICS.writeDataPoint()` (Analytics Engine) for every adoption metric
- Because it's free, queryable via Workers AI SQL, and the project constraint makes it non-optional

**For D1 schema changes:**

- Write additive-only SQL (`ALTER TABLE ... ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
- Never `DROP`, `RENAME`, or modify existing column types
- Because a running Worker may be mid-request when the migration runs; destructive changes break the live deployment

**For exchange WebSocket integration (A4, B1):**

- Connect from a Durable Object (RealtimeHubV2DO), not from a stateless Worker
- Because stateless Workers cannot hold persistent connections; DO instances persist as long as they have open WebSocket clients

**For OHLCV archive reads (B2, backtesting):**

- Read Parquet or newline-delimited JSON from R2 by key prefix (`{exchange}/{symbol}/{date}.ndjson`)
- Because R2 list + get is cheaper than D1 full-table scans on time-series data

**For auth (D1):**

- Use `@simplewebauthn/server` for passkey registration/assertion
- Store session tokens in D1 with `expires_at` column and `SELECT ... WHERE expires_at > now()` guard
- Because no JWT secret rotation complexity and revocation is a single DELETE

**For SEO pages (D6):**

- Render at the edge in the Worker using `c.html()` with static Hono templates
- Cache with `Cache-Control: s-maxage=3600, stale-while-revalidate=86400`
- Because Workers Static Assets serves pre-built HTML; edge-rendered pages get Cloudflare's CDN layer for free

---

## Version Compatibility

| Package                    | Compatible With                   | Notes                                                                                                                                                 |
| -------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| hono@^4.12                 | Workers runtime + `nodejs_compat` | Do not upgrade to any Hono v5 beta without testing; breaking changes in middleware API expected                                                       |
| zod@^4.4                   | @hono/zod-validator@^0.8          | Zod v4 changed the `parse` return type; ensure `@hono/zod-validator` version supports Zod v4 (^0.8.0 confirmed compatible)                            |
| ccxt@^4.5                  | Workers runtime                   | CCXT v4 ships ESM; bundle with Wrangler's esbuild step; some ccxt exchange classes use Node crypto — verify each exchange works under `nodejs_compat` |
| react@^18.3                | react-router-dom@^7               | React Router v7 requires React 18+; concurrent mode features work correctly with TanStack Query v5                                                    |
| tailwindcss@^4.3           | @tailwindcss/postcss@^4.3         | Tailwind v4 uses a new PostCSS plugin (`@tailwindcss/postcss`), not `tailwindcss` directly in `postcss.config.js`; the config format changed from v3  |
| vite@^6.4                  | @vitejs/plugin-react@^4.7         | Vite 6 requires the corresponding plugin-react version; do not mix Vite 6 with older plugin versions                                                  |
| wrangler@^4.103            | workerd (latest)                  | Wrangler 4.x uses the new `wrangler.jsonc` format with JSONC support; `wrangler.toml` still works but `.jsonc` is the project standard                |
| @simplewebauthn/server@^13 | Workers + `nodejs_compat`         | v13 removed Node crypto dependencies that previously broke Workers; confirmed Workers-compatible                                                      |
| protobufjs@^8.6            | Workers runtime                   | v8 is pure-JS; earlier versions had native addons incompatible with Workers                                                                           |

---

## Sources

- Live codebase: `apps/api/package.json`, `apps/web/package.json`, `apps/api/wrangler.jsonc` — HIGH confidence (observed directly)
- Cloudflare docs: https://developers.cloudflare.com/workers/ — Durable Objects, D1, R2, Queues, Workflows, Analytics Engine, Rate Limiting
- Hono docs: https://hono.dev — Workers adapter, middleware
- CCXT: https://github.com/ccxt/ccxt — exchange support matrix, v4 changelog
- TradingView lightweight-charts: https://tradingview.github.io/lightweight-charts/ — performance characteristics
- Tailwind CSS v4: https://tailwindcss.com/blog/tailwindcss-v4 — Oxide engine, PostCSS changes
- React Router v7: https://reactrouter.com/upgrading/v6 — breaking changes from v6
- @simplewebauthn/server v13: https://simplewebauthn.dev/docs/packages/server — Workers compatibility note

---

_Stack research for: Lazuli — edge-native crypto market intelligence platform_
_Researched: 2026-07-11_
