# Lazuli Development Guidelines

## Project Overview

Lazuli is a Cloudflare-native cryptocurrency market intelligence platform. It serves live multi-exchange data, historical OHLCV archives, derivatives intelligence, saved user state, public signal feeds, and shareable market pages.

**Core philosophy:** live exchange data first, durable Cloudflare storage for control-plane state and history, transparent models for derived trading signals.

## Architecture

- **Runtime:** Cloudflare Workers in production; Bun for local tooling, scripts, and tests
- **Monorepo:** Turborepo with Bun workspaces
- **Language:** TypeScript with strict checking
- **API Framework:** Hono on Cloudflare Workers
- **Web Framework:** React 18 + Vite 6, deployed as a Worker/static asset app
- **Primary Data:** CCXT live exchange adapters with Workers-native `fetchImplementation`
- **Storage:** D1 for metadata, accounts, alerts, saved objects, jobs, and manifests
- **Archive:** R2 for historical OHLCV NDJSON gzip objects
- **Realtime:** Durable Objects for market cache, rate limiting, and WebSocket fan-out
- **Background Work:** Cloudflare Queues and Workflows for OHLCV backfills
- **Exchanges:** Binance, Bybit, OKX, Hyperliquid, Upbit

## Development Workflow

```bash
bun install
bun run dev
bun run dev:api
bun run dev:web
bun run build
bun run build:api
bun run build:web
bun run type-check
bun run lint
bun run format
```

Use these checks before handing off production work:

```bash
bun run lint
bun run type-check
bun run format:check
bun run --filter @lazuli/api test
```

## Project Structure

```text
lazuli/
├── apps/
│   ├── api/
│   │   ├── migrations/       # D1 migrations
│   │   ├── scripts/          # route smoke tests and operator scripts
│   │   └── src/
│   │       ├── index.ts      # Hono Worker entrypoint, routes, queue/workflow handlers
│   │       ├── services/     # exchange, cache, backfill, institutional, growth services
│   │       ├── utils/        # validation, security, logging, responses
│   │       └── types/        # Worker Env and API types
│   └── web/
│       ├── src/
│       │   ├── pages/        # app pages and SEO/detail routes
│       │   ├── components/   # shell, charts, UI primitives
│       │   ├── lib/          # API client, query hooks, preferences, URL state
│       │   └── styles/       # brand tokens and global CSS
│       └── worker/           # web Worker entrypoint
├── packages/
│   ├── shared/               # shared TypeScript contracts
│   └── config/               # shared ESLint/TypeScript configs
├── docs/
├── PRODUCT-STRATEGY.md
├── turbo.json
└── package.json
```

## API Surface

All public API routes are under `/api/v1`.

Core live-data routes:

- `GET /exchanges`
- `GET /tickers/:exchange`
- `GET /tickers/:exchange/:symbol`
- `GET /markets/:exchange`
- `GET /ohlcv/:exchange/:symbol`
- `GET /ohlcv/multi/:exchange/:symbol`
- `GET /orderbook/:exchange/:symbol`

Strategy and intelligence routes:

- `GET /screener/:exchange`
- `GET /trending/:exchange`
- `GET /funding/*`
- `GET /arbitrage/prices`
- `GET /liquidations/:exchange/:symbol`
- `GET /orderflow/:exchange/:symbol`
- `POST /backtest/:exchange/:symbol`
- `GET /institutional/*`

Growth and retention routes:

- `POST /auth/magic-link`
- `GET|POST /auth/magic-link/verify`
- `GET /me`
- `GET|POST|DELETE /me/workspaces`
- `GET|POST|DELETE /me/watchlists`
- `GET|POST|DELETE /me/alerts`
- `POST /me/alerts/evaluate`
- `GET|POST|DELETE /me/backtests`
- `GET|POST|DELETE /me/api-keys`
- `GET /alpha-feed`
- `GET /snapshots/market/:exchange/:symbol.svg`

Admin routes require signed admin headers:

- `GET /admin/health`
- `POST /admin/backfills`
- `GET /admin/backfills/:id`
- `POST /admin/backfills/:id/retry`

## Response Format

Keep JSON responses consistent:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "timestamp": 1704067200000,
  "meta": {
    "requestId": "..."
  }
}
```

## Environment And Secrets

Configured in `apps/api/wrangler.jsonc`:

- `ENVIRONMENT`
- `APP_BASE_URL`
- `PUBLIC_API_BASE_URL`
- `CORS_ORIGIN`
- D1, R2, Queues, Workflows, Analytics Engine, and Durable Object bindings

Secrets set through Wrangler:

- `ADMIN_API_KEY`
- `ADMIN_API_KEY_ID`
- `ADMIN_SIGNING_SECRET`
- `MAGIC_LINK_DELIVERY_WEBHOOK_URL` for production magic-link delivery
- `MAGIC_LINK_DELIVERY_WEBHOOK_SECRET` when the delivery webhook requires bearer auth

## Code Standards

1. Use strict TypeScript and explicit domain types.
2. Prefer shared contracts in `packages/shared` for API/web boundaries.
3. Validate all request input with existing validation utilities or Zod schemas.
4. Keep route handlers thin; put business logic in services.
5. Treat exchange failures as transient when possible and return stale/empty metadata instead of crashing broad dashboards.
6. Never commit credentials or raw API keys. Store only token/key hashes in D1.
7. Use additive D1 migrations for deployed schema changes.
8. Document derived trading models clearly, especially liquidation estimates, order-flow proxies, and Greeks.

## Current Track D/E Status

- Track D accounts, saved workspaces/watchlists/alerts/backtests, API keys, Alpha Feed, snapshot SVGs, and SEO detail pages are implemented.
- Track E docs, price alert storage/event bus, options Greeks, full-history backfill defaults, and Binance geo-handling are implemented or documented.
- Binance is enabled, but regional blocking can still occur. Existing exchange error handling degrades with stale/empty metadata when connectivity fails.
