# Strategy completion evidence

[`completion-ledger.json`](./completion-ledger.json) is the machine-readable source of truth for the 26 delivery items in [`PRODUCT-STRATEGY.md`](../../PRODUCT-STRATEGY.md). Its structure is versioned by [`completion-ledger.schema.json`](./completion-ledger.schema.json), and CI validates it with `bun run strategy:validate`.

The human-readable [`implementation-evidence.md`](./implementation-evidence.md) index maps all 26 IDs to current code, tests, and runbooks. It deliberately distinguishes repository evidence from production acceptance evidence.

## Completion contract

An item may use `planned`, `in_progress`, `partial`, or `blocked` without satisfying the final gate. This lets the ledger describe honest intermediate work without making CI fail merely because the 90-day program is unfinished.

Before changing an item to `complete`, all six conditions must be `verified` and contain at least one evidence record:

| Condition               | Evidence expected                                                  |
| ----------------------- | ------------------------------------------------------------------ |
| `endToEndFlow`          | A production-equivalent user-flow result or acceptance report      |
| `automatedVerification` | Unit, contract, integration, or browser test references            |
| `productionEnablement`  | Deployment/flag evidence showing the capability is enabled         |
| `sloObservability`      | Dashboard, monitor, and alert evidence for the capability's SLOs   |
| `recoveryRollback`      | Tested failure-recovery and rollback runbook evidence              |
| `strategyEvidence`      | A review record tying the implementation back to the strategy item |

Across those conditions, a completed item must include `implementation`, `test`, and `production` evidence kinds and a valid `completedAt` timestamp. Evidence references may be repository-relative files (optionally with a Markdown anchor) or HTTPS URLs. Local references are checked for existence; never put secrets, credentials, or private dashboard tokens in the ledger.

## Updating an item

1. Add evidence as work is verified. Use a concrete description and a durable reference, such as a test file, runbook, checked-in release report, or public/dashboard URL.
2. Keep the item `partial` until the capability works end-to-end in production and every condition is supported by evidence.
3. Set all six condition states to `verified`, add `completedAt` in ISO 8601 format, and change the item to `complete` in the same pull request.
4. Run `bun run strategy:validate` and `bun test scripts/validate-strategy-ledger.test.ts`.

The validator also rejects duplicate, missing, or unknown strategy IDs and malformed evidence. Adding or removing a strategy item therefore requires an intentional schema-versioned update to the ledger, validator, strategy document, and tests.

## Operational prerequisites

The [operations index](../operations/README.md) links the realtime architecture decision, provider registry, data model, threat model, SLO/alert specification, recovery runbooks, and executable load/reconnect/soak harness. These files define how acceptance is performed; they do not prove that staging or production acceptance ran. Add sanitized execution reports and production dashboard/flag references to the ledger only after the corresponding gate is actually verified.
