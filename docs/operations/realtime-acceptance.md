# Realtime load, reconnect, and soak acceptance

The harness at `scripts/ops/realtime-acceptance.ts` opens real WebSockets, tracks upgrade/open/close/error counts, topic-local sequence gaps, messages, and process memory, and writes a JSON report. It does not generate market events. Run it only against a staging deployment with live or synthetic signed ingest so sequence and latency assertions are meaningful.

The harness blocks non-local targets unless `--allow-remote` is supplied. A production hostname additionally requires both `--allow-production` and `LAZULI_LOAD_TEST_CHANGE_ID`. Production load tests require an approved change window and operator; the repository does not grant that authority.

## 2,000-client, 60-minute gate

```bash
bun run scripts/ops/realtime-acceptance.ts \
  --mode load \
  --url 'wss://api-staging.lazuli.now/api/v1/ws?topic=ticker:bybit:btcusdt.p' \
  --connections 2000 \
  --ramp-seconds 600 \
  --duration-seconds 3600 \
  --max-open-failures 0 \
  --max-unexpected-closes 0 \
  --max-sequence-gaps 0 \
  --max-memory-growth-mib 256 \
  --min-events 1 \
  --min-latency-samples 1000 \
  --max-latency-p95-ms 800 \
  --allow-remote \
  --report .artifacts/ops/realtime-load.json
```

Pass requires 2,000 peak open sockets, no unexpected closes, no unexplained per-client sequence gaps after snapshot recovery, event and timestamp coverage, p95 source-to-client latency within the declared provider-aware bound, and harness memory growth within the explicitly reviewed bound. Latency sampling uses a bounded 20,000-observation reservoir so the harness itself remains bounded. The dashboard must independently show broker/Container memory, latency, reconnects, and slow-client evictions; client-process memory alone cannot prove server memory stability.

One local source is not accepted as proof when its network path caps concurrent upgrades. The
manual `Staging Realtime Acceptance` workflow runs four synchronized 500-client shards on
independent hosted runners and machine-validates their reports with
`scripts/ops/realtime-aggregate.ts`. Every child must pass; aggregate totals never hide a shard
failure. The workflow is staging-only and cannot target production.

## Reconnect storm

```bash
bun run scripts/ops/realtime-acceptance.ts \
  --mode reconnect \
  --url 'wss://api-staging.lazuli.now/api/v1/ws?topic=ticker:bybit:btcusdt.p' \
  --connections 2000 \
  --ramp-seconds 120 \
  --cycles 5 \
  --cycle-pause-seconds 10 \
  --max-open-failures 0 \
  --allow-remote \
  --report .artifacts/ops/realtime-reconnect.json
```

During the test, verify exponential client/adapter backoff, no synchronized provider reconnect caused by browser reconnects, no cross-topic outage, and recovery of connection/latency levels within 15 minutes.

## 72-hour staging soak

```bash
bun run scripts/ops/realtime-acceptance.ts \
  --mode soak \
  --url 'wss://api-staging.lazuli.now/api/v1/ws?topic=ticker:bybit:btcusdt.p' \
  --connections 250 \
  --ramp-seconds 300 \
  --duration-seconds 259200 \
  --heartbeat-seconds 20 \
  --max-unexpected-closes 5 \
  --max-sequence-gaps 0 \
  --max-memory-growth-mib 256 \
  --min-events 1000 \
  --min-latency-samples 1000 \
  --max-latency-p95-ms 800 \
  --allow-remote \
  --report .artifacts/ops/realtime-soak.json
```

Keep raw dashboards for the entire interval. The release report also needs provider-failure, D1/R2 outage, Queue/DLQ, secret-rotation, deployment restart, and reconciliation drill results. This file and example commands are not evidence that any gate has run.
