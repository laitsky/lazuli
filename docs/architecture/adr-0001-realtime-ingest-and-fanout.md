# ADR-0001: Container ingestion and topic-sharded fan-out

- Status: Accepted
- Date: 2026-07-11
- Owners: Data Platform, API
- Strategy: A0, A4

## Context

Lazuli requires durable public exchange WebSocket connections, provider-specific heartbeat and sequence handling, low-latency browser fan-out, and a bounded failure domain. Cloudflare Workers are request-driven. Durable Object WebSocket hibernation reduces the cost of idle client sockets, but outbound WebSockets do not hibernate and would keep each object active.

## Decision

1. A Cloudflare Container in `apps/ingest` is the only always-on exchange ingestion runtime. Adapters own subscriptions, heartbeat, reconnect with jitter, sequence-gap detection, and REST snapshot reconciliation.
2. The Container normalizes events to the versioned `RealtimeEvent` contract and sends bounded batches to `/internal/realtime/batch`. Requests are timestamped and HMAC-signed. The endpoint is required to reject expired, replayed, malformed, oversized, or private-topic input before production enablement.
3. The API replicates each public topic into four ordered Durable Object fan-out shards and assigns connecting sockets by a hash of the WebSocket handshake key. Private user topics remain on one authorization-isolated object. No global or cross-topic sequence is promised. Eight- and sixteen-shard staging trials saturated the synchronous ingest path under load and caused bounded-buffer drops, so both topologies are explicitly rejected unless the publish path is redesigned and requalified. Four shards are the lossless rollback topology, not evidence that the 2,000-client gate has passed.
4. Each broker persists one bounded checkpoint of sequence, recovery envelopes, and event-ID dedupe state. This is control-plane checkpointing rather than an event archive; R2 remains the high-frequency history store.
5. RealtimeHubDO uses Cloudflare's hibernation API for client sockets. It assigns broker sequence numbers, retains a bounded recovery window, evicts slow clients, and exposes a REST snapshot for gap recovery.
6. High-frequency bodies are ephemeral in broker memory or archived in compressed R2 partitions. Durable Object storage holds only the bounded broker checkpoint; D1 stores ingestion checkpoints, derived rollups, attempts, jobs, and manifests. Queues isolate archival and notification work from the latency path.
7. `/ws` and `/api/v1/ws` implement the same upgrade contract. Private alert topics require short-lived, user-bound subscription tokens.

## Consequences

- A Container restart is recovered with adapter checkpoints and provider REST snapshots; duplicate input is tolerated by event/idempotency identifiers.
- Provider failure is isolated by adapter and topic. Other providers continue independently.
- Broker hibernation reduces idle-client resource use, while the Container's fixed capacity must be monitored and scaled deliberately.
- Topic cardinality, per-shard broker memory, batch size, socket backpressure, replication cost, and Queue lag are explicit capacity constraints.
- The low-latency route remains independent from D1, R2, Queues, and notification delivery. A Durable Object checkpoint failure is surfaced to ingest after fan-out, and event-ID deduplication makes the retry safe.
- REST polling, stale cache metadata, and modeled liquidation/CVD fallbacks are required rollback paths.

## Rejected alternatives

- **Outbound exchange sockets in Durable Objects:** rejected because outbound sockets do not hibernate and pin billable active memory.
- **Queue before fan-out:** rejected because Queue latency would sit on the primary market-event path.
- **One global broker:** rejected because it creates a noisy-neighbor and ordering bottleneck.
- **D1 for every market event:** rejected because D1 is the control plane, not a high-frequency event log.

## Verification

The decision is verified by contract tests, adapter tests, reconciliation drills, and the load/soak harness in [realtime acceptance](../operations/realtime-acceptance.md). A production claim requires retained reports and dashboard links; this ADR alone is not production evidence.
