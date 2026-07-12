# Operational dashboard and SLO incidents

The five operational dashboards are served at `/ops` and read through the Web
Worker's service binding. Cloudflare Access is the identity boundary. The API
accepts only the rotating `OPS_READ_SECRET` from that binding; browser code
never receives admin or read secrets.

## Required configuration

- Protect `/ops*` with a Cloudflare Access self-hosted application.
- Restrict the policy to the operational-owner email.
- Configure `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and
  `OPERATIONAL_OWNER_EMAIL` on the Web Worker.
- Configure the same independent `OPS_READ_SECRET` on Web, API, and ingest.
  Ingest accepts it only on its active read-only health endpoint; mutation
  routes continue to require `CONTROL_API_TOKEN`. Stage `OPS_READ_SECRET_NEXT`
  on the API before rotating the Web value.
- Configure `OPERATIONAL_ALERT_EMAIL` only on the API Worker.

## Dashboard failure

1. Confirm Access returns a valid `Cf-Access-Jwt-Assertion` for the expected
   audience and owner; never bypass JWT validation.
2. Check `/api/v1/admin/observability` with signed admin headers. If it works,
   inspect the Web-to-API service binding and `OPS_READ_SECRET` versions.
3. If the data endpoint fails, use signed `/api/v1/admin/incidents` and the
   sanitized release-state exporter while restoring the dashboard.
4. Do not disable paging to make a release gate pass. Record missing dashboard
   time as telemetry incompleteness and restart the observation window.

## Incident lifecycle

The five-minute monitor opens one incident per environment/policy dedupe key.
It updates the active incident while the breach persists and resolves it when
the SLI recovers. Operators acknowledge or resolve through signed admin
endpoints. Email delivery uses a separate incident/transition idempotency key.

## Rollback

The dashboard is read-only and may be rolled back independently. If migration
`0012` has already been applied, leave its additive tables in place. Roll back
the Web/API deployment, retain incident and evidence rows, and restore the
previous `OPS_READ_SECRET` until the next key version is verified.
