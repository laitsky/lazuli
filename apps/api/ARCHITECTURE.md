# Lazuli API Architecture

The API runs as a Cloudflare Worker named `lazuli-api`.

## Runtime

- Hono handles REST routing.
- CCXT fetches public exchange data with Workers-native `fetchImplementation`.
- Durable Objects prevent public traffic from fanning out directly to exchanges.
- D1 and R2 replace the previous external database storage path.

## Storage

- **D1** stores app metadata, market catalogs, backfill jobs/tasks, and R2 manifests.
- **R2** stores canonical historical OHLCV archives as monthly gzipped NDJSON objects.
- **Durable Object storage** keeps hot cache state and stale-if-error data.

## Backfills

Admin endpoints create bounded OHLCV backfill jobs. Workflows enqueue pending tasks, Queues execute chunks, and `RateLimiterDO` coordinates exchange rate-limit pressure.

## Security

Admin routes require `ADMIN_API_KEY` outside local development. Production and staging secrets are stored with Wrangler secrets, not committed to the repository.
