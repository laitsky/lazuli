# Lazuli threat model

## Scope and trust boundaries

The scope includes the browser/Web Worker, API Worker, ingest Container, Durable Objects, D1, R2, Queues, Workflows, Analytics Engine, public exchange providers, macro providers, and user-owned notification endpoints. Market data is public; accounts, saved state, private topics, notification endpoints, tokens, and operational secrets are not.

Key boundaries are browser-to-API, Container-to-internal-ingest, API-to-Durable-Object, Queue producer-to-consumer, and Lazuli-to-user webhook/provider. Cloudflare bindings are preferred over public service URLs for internal calls where supported.

## Threats and required controls

| Threat                              | Required prevention                                                                                                                                                                               | Required detection / test                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Session theft or fixation           | `HttpOnly`, `Secure`, `SameSite=Lax` cookies; short expiry; rotate session after login/passkey and privilege change; revoke by device                                                             | Session-rotation and revoked-cookie integration tests; anomalous session audit event                       |
| CSRF on cookie-authenticated writes | Exact Origin allowlist and CSRF token where Origin cannot establish intent; reject missing/mismatched Origin; bearer API clients remain supported                                                 | Browser tests for cross-origin POST/DELETE and allowed same-origin requests                                |
| Cross-user private topic access     | Short-lived HMAC token bound to user ID and exact topic; authorize before DO lookup; no wildcard private topics                                                                                   | Tests for another user's topic, modified topic, expired token, and replay after expiry                     |
| Internal ingest forgery/replay      | Dedicated secret; HMAC over timestamp plus raw body; constant-time compare; strict clock window; nonce/batch ID replay cache; body/event bounds; public-topic allowlist                           | Bad signature, stale timestamp, reused batch ID, oversized body, and private-topic tests; rejection metric |
| Webhook SSRF                        | HTTPS only; parse and canonicalize URL; reject credentials, fragments, localhost, private/link-local/reserved IPs; resolve DNS and re-check redirects; bounded timeout/body; no arbitrary headers | IPv4/IPv6 private ranges, DNS rebinding, redirect-to-private, unusual ports, and timeout tests             |
| Secret leakage                      | Wrangler secrets/KMS; encrypt notification endpoints; redact logs/errors; never emit auth headers, magic links, webhook bodies, or ciphertext                                                     | Log-scrape tests and secret canary in staging; repository secret scan                                      |
| API-key compromise                  | Display once; store strong hash only; scoped permissions; tiered rate limits; last-used timestamps; revoke immediately                                                                            | Hash-at-rest test, scope bypass and rate-limit bypass tests, revocation test                               |
| Ingest sequence spoof/gap           | Provider adapter validation, upstream sequence tracking, snapshot reconciliation, topic-local broker sequence                                                                                     | Gap/reorder fixtures, reconciliation drill, unexplained-gap alert                                          |
| Queue duplicate delivery            | Stable event/channel idempotency key and unique constraint; transactional state transitions                                                                                                       | Duplicate/retry integration test; duplicate-delivery SLO counter                                           |
| Slow-client resource exhaustion     | Bounded broker window and send buffer; per-IP admission/rate controls; slow-client eviction                                                                                                       | 2,000-client burst and slow-consumer chaos test; memory/eviction dashboard                                 |
| Storage abuse or corrupt object     | Authz on user keys, predictable prefix prohibition, checksums/manifests, size/range bounds                                                                                                        | Cross-user access tests, corrupt R2 fixture, D1/R2 outage drill                                            |
| Dependency/supply-chain compromise  | Locked Bun dependencies, Dependabot, CI audit/provenance, least-privilege CI tokens                                                                                                               | Security workflow and release dependency review                                                            |

## Privacy and logging

Analytics uses coarse, allowlisted dimensions. Never write email, IP address, session/token, user-agent fingerprint, alert condition body, strategy body, API key, channel endpoint, or URL query containing a token. Logs use request/event IDs and pseudonymous user identifiers only when operationally necessary. Error details returned publicly are generic.

## Security release gate

Before enabling an account, alert, or realtime flag, all applicable controls above need automated evidence plus a staging test. A threat-model row is not implementation evidence. Open findings must have severity, owner, target date, and explicit release disposition.
