# Secret rotation

## Scope

Admin signing keys, internal ingest HMAC, the shared `METRICS_INGEST_SECRET` on the API and Web Workers, realtime token HMAC, alert-webhook signing, notification endpoint encryption, and any provider token. Magic links and alerts use the Cloudflare Email Service bindings; those bindings have no application bearer secret. API keys belong to users and are revoked/reissued, not decrypted.

## Planned rotation

1. Inventory consumers and owners without printing secret values. Create a change record and rollback window.
2. Generate the new secret in an approved password/KMS process. Add the matching `*_NEXT` secret and `*_NEXT_ID` version without changing the current pair.
3. Deploy verifiers accepting current and next versions; emit only key ID/version in logs.
4. Update producers to send the current key ID in `X-Lazuli-Key-Id` or the realtime token `kid`, then verify signed requests/tokens/delivery in staging and canary production.
5. For notification encryption, repeatedly call signed `POST /api/v1/admin/notification-channels/re-encrypt` with the returned cursor until `done=true`; verify `targetKeyId` on every page.
6. Promote next to current only after the re-encryption job is complete, then wait beyond maximum token/retry lifetime before removing old acceptance and revoking the old secret.
7. Scan logs/artifacts and record version IDs, times, synthetic results, and operators—never secret material.

## Emergency rotation

Disable the affected external or internal write path, revoke compromised credentials first, rotate all environments independently, invalidate related sessions/tokens, inspect access logs, and open a security incident. Do not reuse a production secret in staging.

Rollback means temporarily returning producers to the prior still-valid key during the approved overlap. After suspected disclosure, rollback to the compromised key is forbidden.
