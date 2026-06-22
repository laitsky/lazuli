# Admin Key Rotation Runbook

## Rotation

1. Generate a new high-entropy `ADMIN_SIGNING_SECRET`.
2. If rotating identity as well, update `ADMIN_API_KEY_ID` in `apps/api/wrangler.jsonc`.
3. Set the signing secret in Cloudflare:
   ```bash
   cd apps/api
   bunx wrangler secret put ADMIN_SIGNING_SECRET --env staging
   bunx wrangler secret put ADMIN_SIGNING_SECRET --env production
   ```
4. Deploy if `ADMIN_API_KEY_ID` changed, or confirm the Worker is using the updated secret.
5. Update the trusted operator secret store.

## Verification

1. Send a signed request with `X-Admin-Key-Id`, `X-Admin-Timestamp`, `X-Admin-Nonce`, and `X-Admin-Signature`.
2. Confirm the old signing secret is rejected outside local development.
3. Confirm `/api/v1/admin/health` succeeds with the new key.
4. Replay the same signed request and confirm it is rejected as nonce reuse.

## Emergency Rotation

1. Rotate staging first only if production is not actively compromised.
2. Rotate production immediately if the key may have leaked.
3. Review logs for rejected signatures, unusual admin paths, and suspicious timestamps.
