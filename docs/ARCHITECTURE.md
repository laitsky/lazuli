# Lazuli Architecture Overview

## Core Design Philosophy

Lazuli is Cloudflare-native in production. Request/response market data uses CCXT and Durable Object caches. The low-latency path uses an always-on Cloudflare Container for exchange WebSockets and topic-sharded, hibernating Durable Objects for client fan-out. Cloudflare storage and coordination primitives provide the durable control plane.

## Data Flow

### Live Market Path

```
User Request -> Web Worker -> API Worker -> MarketDataCacheDO -> CCXT Exchange APIs
```

Tickers and funding rates use a five-second cache target. Market catalogs refresh hourly.

### Realtime Market Path

```text
Exchange WebSockets -> Ingest Container -> signed batch endpoint -> RealtimeHubDO(topic)
                                                             |-> browser WebSockets
                                                             |-> Queues -> R2/rollups/delivery
```

The Container owns outbound exchange connections, heartbeat, reconnect, sharding, and snapshot reconciliation. A Durable Object ID is derived from each normalized topic. RealtimeHubDO instances keep a bounded recovery/idempotency checkpoint and use the hibernation WebSocket API for browser connections. The checkpoint retains only the last 256 envelopes and 2,048 event IDs so partial ingest retries cannot duplicate trade, CVD, or liquidation events after hibernation. They do not open outbound exchange sockets. REST snapshots and polling remain the recovery and rollback paths.

The accepted decision and its operational consequences are recorded in [ADR-0001](./architecture/adr-0001-realtime-ingest-and-fanout.md).

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
- **Cloudflare Container**: Always-on public exchange WebSocket ingestion
- **Workers Static Assets**: Vite SPA served by `lazuli-web`
- **Durable Objects**: Live market cache, exchange rate limiter, and topic-sharded hibernating client fan-out
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

## Operational References

- [Provider registry](./operations/provider-registry.md)
- [Data model and migration policy](./DATA-MODEL.md)
- [Threat model](./THREAT-MODEL.md)
- [SLOs and observability](./operations/SLOS-AND-OBSERVABILITY.md)
- [Operations and acceptance index](./operations/README.md)
