# Supply Chain Notes

## Dependency Overrides

Root `package.json` uses `overrides` to force patched transitive dependency versions while upstream packages catch up. Review these overrides during scheduled Dependabot updates and remove each override once the direct dependency tree naturally resolves to the patched version.

Current override categories:

- Build/parser tooling: `@babel/core`, `rollup`, `yaml`, `js-yaml`, `fast-uri`, `flatted`, `picomatch`, `brace-expansion`.
- Runtime/browser transitive fixes: `form-data`, `@sentry/browser`.

## CI Gates

Production deploys should require the GitHub CI and Security workflows to pass before Cloudflare deployment. Branch protection should also require CODEOWNERS review for workflow files, Wrangler configs, package manifests, lockfiles, and security-sensitive API utilities.

## OSV Scanning

The Security workflow runs `bun audit` and OSV against `bun.lock`. If OSV lockfile support changes or fails in CI, generate an SBOM from the resolved Bun workspace and scan the SBOM as the fallback gate instead of removing OSV coverage.
