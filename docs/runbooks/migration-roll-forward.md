# Additive migration roll-forward and rollback limits

## Before application

1. Verify the migration is new, immutable, additive, bounded, and compatible with both old and new application versions.
2. Apply the full migration set to an empty local D1 database.
3. Apply pending migrations to a sanitized prior-version fixture and run contract/integration tests.
4. Back up the target D1 database and record backup ID, migration filename/checksum, deployment version, owner, and maintenance window.
5. Apply staging, run old/new-version smoke tests, and observe query error/latency.

## Production roll-forward

Apply the migration before code that requires it, while old code remains compatible. Verify schema objects, constraints, representative reads/writes, Queue consumers, and error rate. Then canary application flags.

## Failure response

- Stop rollout and disable the dependent feature flag.
- Prefer deploying compatible old code or a new compensating additive migration.
- Never edit an applied migration, drop a column/table, or restore an older backup over new writes without incident-command approval and a documented data-loss assessment.
- A backup restore creates a recovery database for validation first. Cutover is a last resort with explicit reconciliation of writes since backup.

Close after forward compatibility and data counts are verified. Record the rehearsal/incident as recovery evidence; the runbook itself is not evidence that rollback was tested.
