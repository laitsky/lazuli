# Lazuli Architecture Overview

## Core Design Philosophy

Lazuli is Cloudflare-native in production. Live market data is fetched from exchanges through CCXT, served through Durable Object caches, and backed by Cloudflare storage and coordination primitives.

## Data Flow

### Live Market Path

```
User Request -> Web Worker -> API Worker -> MarketDataCacheDO -> CCXT Exchange APIs
```

Tickers and funding rates use a five-second cache target. Market catalogs refresh hourly.

### Historical OHLCV Path

```
User Request -> API Worker -> D1 Manifest Lookup -> R2 Monthly NDJSON Archive
```

Historical archive objects are stored in R2 as gzipped monthly NDJSON files. D1 stores metadata, manifests, and job state only.

### Backfill Path

```
Admin Request -> API Worker -> Workflow -> Queue -> RateLimiterDO -> CCXT -> R2 + D1
```

Backfills are idempotent, task-based, and retry-aware. Queue retries stay pending until the terminal retry limit, then become failed tasks with enough context to resume.

## Cloudflare Components

- **Workers**: `lazuli-api` and `lazuli-web`
- **Workers Static Assets**: Vite SPA served by `lazuli-web`
- **Durable Objects**: Live market cache and exchange rate limiter
- **D1**: Metadata, catalogs, manifests, backfill jobs/tasks, admin state
- **R2**: Canonical OHLCV archives
- **Queues + Workflows**: Reliable historical backfill orchestration
- **Analytics Engine**: API latency and operational metrics

## Production URLs

- API: `https://api.lazuli.now`
- Web: `https://lazuli.now`
- Web alias: `https://www.lazuli.now`
- API: `https://lazuli-api.vincent-diamond15.workers.dev`
- Web: `https://lazuli-web.vincent-diamond15.workers.dev`

Custom domain routes are configured for `lazuli.now`, `www.lazuli.now`, and `api.lazuli.now`.
