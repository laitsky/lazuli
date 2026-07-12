# D1 and R2 outage response

## D1 outage

1. Confirm scope and error rate. Keep public stateless market reads and realtime fan-out running.
2. Fail authenticated writes explicitly with retryable status; do not acknowledge saved state, alerts, or jobs that were not committed.
3. Pause Queue consumers whose idempotency/state transition depends on D1 so messages retry safely.
4. Do not evaluate alerts from an unversioned in-memory copy of user rules.
5. After recovery, verify migrations/schema, replay bounded queues, reconcile checkpoints, and compare counts before restoring flags.

## R2 outage

1. Keep live realtime/REST paths active. Mark archive/backtest responses unavailable or partial with explicit coverage.
2. Pause archive writes and full-history jobs; synchronous quick tests may continue only when their requested data is available.
3. Let Queue messages retry within retention. Do not mark an archive partition complete until object checksum and manifest transaction both succeed.
4. After recovery, reconcile D1 manifests against R2 object existence/checksum, backfill gaps, and resume jobs gradually.

## Combined outage

Preserve the primary ephemeral fan-out if healthy, disable persistence-dependent flags, and prefer an explicit 503 over accepting writes. Roll back the last deploy only when evidence correlates it with the outage. Never delete or destructively migrate state as incident mitigation.

Close after error rates normalize for 30 minutes, queues drain without duplicates, manifests/checkpoints reconcile, synthetic saved-state and archive flows pass, and the incident interval is documented.
