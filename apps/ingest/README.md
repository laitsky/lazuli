# Lazuli ingest

Always-on public market ingestion for Lazuli. A small Cloudflare Worker controls one
Cloudflare Container; the Bun process in that container maintains exchange WebSockets,
normalizes events to `@lazuli/shared`'s `RealtimeEvent` contract, and sends bounded HMAC-
signed batches to the API.

## Configuration

The Worker passes only public configuration and the ingest signing secret into the
container. Set secrets independently for each environment:

```bash
wrangler secret put INGEST_SIGNING_SECRET
wrangler secret put CONTROL_API_TOKEN
wrangler secret put INGEST_SIGNING_SECRET --env staging
wrangler secret put CONTROL_API_TOKEN --env staging
wrangler secret put INGEST_SIGNING_SECRET --env production
wrangler secret put CONTROL_API_TOKEN --env production
```

`INGEST_SYMBOLS` is a comma-separated list of canonical `BASE/QUOTE` markets, capped at 50. `INGEST_PROVIDERS` selects any of `binance,bybit,okx,hyperliquid,upbit`. Upbit maps
the configured base assets to `UPBIT_QUOTE` (KRW by default), because it does not list the
same USDT markets as the derivatives venues.

`POST /start` requires `Authorization: Bearer $CONTROL_API_TOKEN` outside local mode.
`GET /health` starts the singleton if necessary and returns adapter plus batch health.
The two-minute cron is the production keepalive and restart supervisor.

## Delivery contract

The container posts to `/internal/realtime/batch` with:

- `X-Lazuli-Timestamp`: Unix milliseconds
- `X-Lazuli-Signature`: `sha256=<hex HMAC-SHA256>` over `<timestamp>.<raw JSON body>`
- `X-Lazuli-Ingest-Batch-Id`: retry-stable correlation/idempotency identifier

Buffers are memory-bounded. Failed batches are retried with exponential jitter and put
back at the front of the bounded queue. Older events are dropped under sustained
backpressure, and the count is exposed by `/health` rather than hidden.

## Local verification

```bash
bun install
bun run --filter @lazuli/ingest type-check
bun run --filter @lazuli/ingest build
```

The Wrangler build requires a running Docker-compatible daemon because it builds the
container image even in dry-run mode.
