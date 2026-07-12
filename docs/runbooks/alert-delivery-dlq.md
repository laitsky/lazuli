# Alert delivery Queue and DLQ recovery

The implementation-specific bindings, secrets, and user retry route are documented in [Alert delivery operations](./alert-delivery.md). This runbook defines incident handling and replay acceptance.

## Trigger

Queue age/retry spike, provider delivery failures, duplicate-delivery counter, or untriaged DLQ item approaching 15 minutes.

## Contain

1. Identify channel/provider and first affected idempotency key. Redact destinations and payloads.
2. On any duplicate, disable the affected channel consumer flag immediately; alert evaluation may continue to record events.
3. For provider outage/rate limit, reduce consumer concurrency and honor retry-after. Never bypass the unique idempotency constraint.
4. For SSRF or secret exposure suspicion, pause webhook delivery and invoke secret rotation/security response.

## Diagnose and repair

Inspect attempt state, attempt number, timestamps, redacted status, and Queue message ID. Classify transient provider error, invalid user endpoint, application defect, or storage outage. Fix the cause and deploy before replay. Terminal invalid endpoints remain failed and visible to the user.

## Replay

1. Export the affected message/idempotency keys and expected count.
2. Requeue with signed `POST /api/v1/admin/alert-deliveries/{id}/replay`; never edit delivered rows to queued. Supply a change ID, reason, and `confirmDuplicateRisk: true`. The route appends a sanitized `audit_events` record in the same D1 batch. For an
   indeterminate Email, Discord, or Telegram attempt, warn that manual replay can duplicate a
   provider-accepted message and require explicit operator confirmation.
3. Consumer conditionally claims only non-delivered attempts and records every retry.
4. Verify one terminal attempt per event/channel key and user-visible status; webhook receivers
   must prove idempotency-key deduplication before replay.
5. Drain in bounded batches while watching dispatch latency, Queue age, and provider quota.

Close after DLQ age is zero, all items are triaged, duplicate counter is zero, and a sample end-to-end delivery is verified. Preserve a sanitized replay report.
