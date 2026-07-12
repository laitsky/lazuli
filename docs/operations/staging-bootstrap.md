# Staging bootstrap and release boundary

This procedure is authorized for staging only. It does not authorize a production deploy, production migration, production secret mutation, or production rollout. Stop after staging evidence is assembled and require an explicit approval plus change-window ID.

## Preflight

1. Confirm the release commit and draft PR are current and CI/review are green.
2. Confirm Workers Paid, Container capacity, Email Service domain onboarding, verified staging recipient, and live account usage. The staging Workers use Custom Domains so deployment creates and manages the proxied `api-staging` and `staging` DNS records through Workers route permissions.
3. Record only secret names and version IDs. Generate independent staging values for admin, ingest, metrics, realtime token, notification encryption, alert webhook signing, and ingest control.
4. Export D1 and record a Time Travel bookmark before applying additive migrations `0007` through `0012`.

## Deploy dark

Deploy API, Web, and ingest staging services. The legacy booleans stay `false`; migration `0010` initializes audited D1 controls in `off`. Validate public and signed deep health, bindings, Container state, provider freshness, Queue/DLQ presence, R2, D1, Analytics Engine, and both Email Service send bindings.

Use the signed release-control endpoint to advance one flag at a time. Every mutation supplies `expectedRevision`, reason, key ID, timestamp, nonce, and signature. Internal user cohorts use subject allowlists. Realtime ingestion uses provider/topic allowlists.

## Acceptance and drills

Run two isolated browser profiles, the 2,000-client load and reconnect gates, and the continuous 250-client soak. Fault injection is signed, expires in 5–900 seconds, and is available only in staging/local:

```bash
bun run ops:chaos -- --target d1 --duration-seconds 30 --change-id CHG-STAGING-001
bun run ops:chaos -- --target r2 --duration-seconds 30 --change-id CHG-STAGING-001
bun run ops:chaos -- --target queue --duration-seconds 30 --change-id CHG-STAGING-001
bun run ops:chaos -- --target delivery --duration-seconds 30 --change-id CHG-STAGING-001
bun run ops:chaos -- --target provider --provider bybit --duration-seconds 30 --change-id CHG-STAGING-001
```

Record provider reconciliation, deployment restart, D1/R2 outage, Queue/DLQ replay, dual-secret rotation, notification re-encryption, Time Travel migration rehearsal, and fallback rollback. A duplicate delivery, authorization leak, unexplained sequence gap, missing telemetry, SLO breach, or untriaged DLQ item older than 15 minutes fails acceptance.

## Stop condition

Export the sanitized release state and assemble the evidence manifest. Do not mark any strategy ledger item complete: production evidence is mandatory. Present release SHA, draft PR, cost/usage estimate, dashboards, reports, and rollback state for approval. Production begins only after the user supplies explicit authorization and a valid change-window ID.
