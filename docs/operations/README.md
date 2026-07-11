# Operations and acceptance

This directory is the operational source of truth for the 90-day strategy program. Repository documents describe expected controls. They are not evidence that a staging or production drill ran.

## Reference

- [Provider registry](./provider-registry.md)
- [SLOs, dashboards, and alerts](./SLOS-AND-OBSERVABILITY.md)
- [Realtime load, reconnect, and soak acceptance](./realtime-acceptance.md)
- [Staging bootstrap and release boundary](./staging-bootstrap.md)
- [Architecture decision](../architecture/adr-0001-realtime-ingest-and-fanout.md)
- [Data model and migrations](../DATA-MODEL.md)
- [Threat model](../THREAT-MODEL.md)

## Runbooks

- [Realtime provider failure and reconciliation](../runbooks/realtime-provider-failure.md)
- [Alert delivery Queue and DLQ](../runbooks/alert-delivery-dlq.md)
- [D1 and R2 outages](../runbooks/d1-r2-outage.md)
- [Secret rotation](../runbooks/secret-rotation.md)
- [Migration roll-forward and rollback limits](../runbooks/migration-roll-forward.md)
- [Feature-flag rollout and rollback](../runbooks/feature-flag-rollout.md)

## Evidence handling

Acceptance reports belong under an immutable release artifact or approved private evidence store. Check in only sanitized summaries. Each summary must record environment, deployment version, start/end time, operator, configuration, result, unexplained gaps, incidents, and links to raw telemetry. Never store tokens, webhook URLs, cookies, API keys, account identifiers, or dashboard credentials.

Operational commands are guarded and write local reports under `.artifacts/ops` by default:

```bash
bun run ops:synthetic -- --url http://127.0.0.1:8787/internal/realtime/batch
bun run ops:evidence:export -- --output .artifacts/ops/release-state-staging.json
bun run ops:evidence:validate -- .artifacts/ops/release-evidence-staging.json
```

`ops:evidence:export` records only deployment IDs/times, migration summaries, Queue names, rollout states/counts, and SLO queries. It strips rollout identities and never exports secret values. Remote synthetic ingest needs `--allow-remote`; production additionally requires the production opt-in and a change-window ID.
