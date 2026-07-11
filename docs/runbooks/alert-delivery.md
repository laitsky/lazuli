# Alert delivery operations

Alert evaluation publishes the private realtime event first, then creates one
idempotent D1 attempt per selected notification channel and enqueues it on
`ALERT_DELIVERY_QUEUE`. Endpoints and per-channel webhook secrets are stored only
as AES-256-GCM ciphertext with user/channel/field-bound additional authenticated
data. API responses expose masked endpoints only.

## Required secrets

Set these independently in staging and production with `wrangler secret put`:

- `NOTIFICATION_ENCRYPTION_KEY`: at least 32 random characters. Treat this as a
  key-encryption root; loss makes existing channel endpoints unrecoverable.
- `ALERT_EMAIL_DELIVERY_WEBHOOK_URL` and optional
  `ALERT_EMAIL_DELIVERY_WEBHOOK_SECRET`: free-tier HTTP email adapter.
- `ALERT_TELEGRAM_BOT_TOKEN`: provider token for Telegram channels.
- `ALERT_WEBHOOK_SIGNING_SECRET`: fallback HMAC secret for HTTPS webhooks.

Enable user HTTPS webhooks only with `ALERT_USER_WEBHOOKS_ENABLED=true` after the
staging SSRF suite and delivery drill pass. Discord URLs and per-channel webhook
secrets are user-owned encrypted channel values, never Worker variables.

## Failure and recovery

Transient failures use exponential Queue retries (5 seconds to 15 minutes).
Non-retryable HTTP 4xx responses are marked `failed`. Exhausted messages are
marked `dead_letter` in D1 and forwarded to the configured Cloudflare DLQ. Users
can inspect delivery state and explicitly retry failed/dead-letter attempts via
`POST /api/v1/me/alert-deliveries/{id}/retry` after correcting the channel.

The scheduled handler re-enqueues due `queued`/`retry` attempts, covering the
small failure window between the idempotent D1 insert and Queue send. The unique
`idempotency_key` prevents duplicate attempts for the same event and channel;
the conditional `processing` claim prevents duplicate provider dispatch.

Operator checks:

1. Alert Queue lag and DLQ depth are zero or understood.
2. No `dead_letter` row is older than 15 minutes without triage.
3. Delivery success rate and p95 dispatch latency meet the release SLO.
4. Logs contain attempt/channel IDs only—never endpoints, message secrets, or
   provider credentials.

## Key rotation and rollback

Before rotating `NOTIFICATION_ENCRYPTION_KEY`, deploy a dual-read/key-version
migration and re-encrypt all channels. Never overwrite the key directly. A safe
application rollback leaves the additive tables and queue intact; disable alert
evaluation, keep the queue consumer running until drained, and preserve private
realtime delivery as the user-visible fallback.
