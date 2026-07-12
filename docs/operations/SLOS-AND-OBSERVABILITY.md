# SLOs, dashboards, and alerts

## Release SLOs

| SLI                           | Objective                                   | Measurement                                                                                                 |
| ----------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Public API availability       | 99.9% rolling 30 days                       | Good non-5xx eligible requests / eligible requests, excluding documented provider-caused degraded successes |
| Public WebSocket availability | 99.9% rolling 30 days                       | Successful upgrade plus sustained heartbeat for eligible synthetic sessions                                 |
| Primary liquidation latency   | p95 < 800 ms where upstream cadence permits | Client receipt minus exchange timestamp; report by exchange and source cadence                              |
| Alert evaluation latency      | p95 < 2 s                                   | Evaluation completion minus normalized market-event ingest timestamp                                        |
| Alert dispatch latency        | p95 < 10 s                                  | First provider request minus alert event creation                                                           |
| Duplicate alert deliveries    | 0                                           | Count delivered attempts grouped by event/channel idempotency key beyond one                                |
| DLQ age                       | No untriaged item > 15 min                  | Oldest unacknowledged DLQ item timestamp                                                                    |
| Provider freshness            | Every configured shard < 2 min              | Active signed ingest health, reported independently by provider                                             |
| Realtime drops/gaps           | 0                                           | New dropped events and unresolved sequence gaps from clean acceptance counters                              |
| D1/R2 availability            | 100% during release windows                 | Five-minute D1 control query and bounded R2 list probe                                                      |
| Archive gaps                  | 0 unresolved                                | Failed manifests plus explicit gap counts in completed archive manifests                                    |

The 800 ms objective cannot be used to hide provider cadence. Show upstream exchange-to-ingest and Lazuli ingest-to-client separately. A Binance stream that batches at approximately 1,000 ms is marked source-limited; the internal segment still has its own target.

## Required dashboards

1. **Realtime overview:** provider state/freshness, connections current/peak, events and bytes per second, reconnects, sequence gaps, reconciliations, broker memory/window occupancy, slow-client eviction, source-to-ingest and ingest-to-client p50/p95/p99 by exchange/topic.
2. **Alerts:** evaluated/triggered/deduplicated, evaluation p95, Queue depth/oldest age, attempts by status/provider, dispatch p95, delivery success, duplicate counter, DLQ age and triage state.
3. **Storage/jobs:** D1 errors/latency, R2 reads/writes/errors, Queue lag/retries, Workflow failures, archive gaps, async backtest queue/runtime/progress/cancellations.
4. **Product completeness:** WAU, alert subscribers, WS connections, API keys issued/used, SEO landings, backtest runs, liquidation latency, baseline/target/trend, and daily aggregate completeness.
5. **Release:** version/flags by environment, synthetic checks, error-budget burn, deployment markers, open incidents.

Dashboard queries/configuration must be exported or linked from the strategy ledger without credentials. A dashboard existing is insufficient; it needs current data, owner, and alert links.

The protected `/ops` dashboard implements these five views from signed D1
rollups and synthetic probes. Its machine-readable panel and paging contract is
checked in as [`dashboard-definitions.json`](./dashboard-definitions.json).
Cloudflare Access validates the operational owner before the Web Worker uses a
read-only service binding; admin credentials are never sent to the browser.

## Paging and ticket alerts

| Condition                                                   | Severity               | Initial response                                                 |
| ----------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| API or WS 5m/1h multi-window error-budget burn              | Page                   | Roll back recent flag/deploy; confirm dependency scope           |
| All adapters disconnected or primary provider stale > 2 min | Page                   | Invoke provider failure runbook                                  |
| Single provider stale > 5 min or reconnect storm            | Ticket/page by traffic | Isolate adapter and retain other providers                       |
| Unexplained sequence gap after reconciliation               | Page                   | Freeze affected derived stream and investigate                   |
| Alert duplicate > 0                                         | Page                   | Pause affected delivery channel and preserve attempts            |
| Oldest delivery DLQ > 15 min                                | Page                   | Triage and replay only after cause fixed                         |
| Queue oldest age > 5 min, D1/R2 error > 2% for 5 min        | Page                   | Invoke storage/DLQ runbook                                       |
| Free provider quota > 80% or 429 rate > 1%                  | Ticket                 | Reduce cadence/cache; declare capacity blocker before exhaustion |
| Daily metric completeness < 0.98                            | Ticket                 | Repair aggregation; do not interpret adoption trend              |

## Instrumentation contract

All hops propagate request ID and event ID. Realtime measurements include exchange, normalized topic family, source kind, provider timestamp availability, exchange timestamp, ingest timestamp, broker publish timestamp, and client receipt timestamp. Dimensions must be bounded and privacy-safe; raw symbols may be reduced to an allowlisted top-market set for Analytics Engine cardinality.

Every alert has an owner, severity, runbook URL, deduplication key, and test cadence. Test paging routes quarterly and non-page alerts monthly. Record mute windows and never disable alerts merely to satisfy a gate.
