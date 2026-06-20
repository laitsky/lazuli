# Spike: CCXT on Cloudflare Workers

**Date:** 2026-06-17
**Verdict:** ✅ **CCXT WORKS on Cloudflare Workers** with two required workarounds (install `protobufjs` as a sibling dependency, and inject the native `fetch` via `fetchImplementation`). All 14 tested operations across 5 exchanges succeed in local `workerd` emulation. Recommend proceeding with CCXT on Workers rather than hand-rolling `fetch()` calls.

---

## 1. Environment

| Component     | Version                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Node          | v24.11.1                                                                                                                                |
| Bun           | 1.3.7                                                                                                                                   |
| wrangler      | 4.101.0                                                                                                                                 |
| ccxt          | 4.5.59 (installed; note: CCXT's internal `Exchange.ccxtVersion` reports `4.5.58` from the `vss.js` build step - cosmetic mismatch only) |
| protobufjs    | 8.6.4 (added as sibling dep, see §4)                                                                                                    |
| Runtime       | Cloudflare Workers (local `wrangler dev --local`, workerd)                                                                              |
| Compatibility | `compatibility_date = "2025-09-01"`, `compatibility_flags = ["nodejs_compat"]`                                                          |
| OS            | macOS 25.5.0                                                                                                                            |

## 2. Configuration Used

### `wrangler.toml`

```toml
name = "spike-ccxt"
main = "src/index.ts"
compatibility_date = "2025-09-01"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true
```

### Dependencies added

```bash
bun add -d wrangler
bun add ccxt protobufjs   # protobufjs is the workaround, see §4
```

### Exchange construction (critical pattern)

```ts
import { binance, bybit, okx, binanceusdm, hyperliquid } from 'ccxt';

// CRITICAL: fetchImplementation MUST be set, otherwise CCXT picks its bundled
// node-fetch (because isNode=true under nodejs_compat) and gzip responses are
// NOT decompressed, producing garbled payloads. See §5 for full diagnosis.
const exchange = new binance({
  enableRateLimit: true,
  fetchImplementation: fetch as any,
});
```

Full source is preserved at `spike-ccxt-worker/src/index.ts`.

## 3. Results Per Exchange Per Operation

All results captured from a single `curl http://localhost:8787/` invocation against `wrangler dev --local`. Total handler wall time: **~19.9 s** (dominated by Hyperliquid's `loadMarkets` at 11.8 s).

| #   | Test                                                    | OK  | Time (ms) | Notes                                                                            |
| --- | ------------------------------------------------------- | --- | --------- | -------------------------------------------------------------------------------- |
| 1   | `construct.binance.spot`                                | ✅  | 9         | Constructor only                                                                 |
| 2   | `construct.bybit.spot`                                  | ✅  | 4         |                                                                                  |
| 3   | `construct.okx.spot`                                    | ✅  | 4         |                                                                                  |
| 4   | `construct.binance.future` (USDT-M)                     | ✅  | 4         |                                                                                  |
| 5   | `construct.hyperliquid.swap`                            | ✅  | 2         |                                                                                  |
| 6   | `binance.spot.loadMarkets`                              | ✅  | 3254      | 4427 markets                                                                     |
| 7   | `binance.spot.fetchTickers`                             | ✅  | 667       | 3600 tickers                                                                     |
| 8   | `binance.spot.fetchOHLCV('BTC/USDT','1h',undefined,24)` | ✅  | 913       | 24 candles, last `[1781712000000, 65751.99, 66445.93, 65722, 66080, 1001.17857]` |
| 9   | `binance.spot.fetchOrderBook('BTC/USDT')`               | ✅  | 132       | 100 bids / 100 asks; top bid `[66080, 0.02082]`                                  |
| 10  | `bybit.spot.fetchTicker('BTC/USDT')`                    | ✅  | 1218      | last=66075, bid=66074.9, ask=66075                                               |
| 11  | `okx.spot.fetchTickers`                                 | ✅  | 1204      | 1260 tickers                                                                     |
| 12  | `binance.future.loadMarkets`                            | ✅  | 417       | 792 markets                                                                      |
| 13  | `binance.future.fetchFundingRates`                      | ✅  | 239       | 798 funding rates; sample `AGLD/USDT:USDT` rate 0.0001                           |
| 14  | `hyperliquid.swap.loadMarkets`                          | ✅  | 11778     | 722 markets (slow; see §7)                                                       |

**Summary: 14/14 OK, 0 failed.**

### Sample payloads

`binance.spot.fetchOHLCV` last candle:

```json
[1781712000000, 65751.99, 66445.93, 65722, 66080, 1001.17857]
```

`binance.future.fetchFundingRates` sample entry:

```json
{
  "symbol": "AGLD/USDT:USDT",
  "markPrice": 0.17454713,
  "indexPrice": 0.17453084,
  "fundingRate": 0.0001,
  "fundingDatetime": "2026-06-18T00:00:00.000Z"
}
```

## 4. Errors & Workarounds

### Issue 1 — Bundle error: `Could not resolve "protobufjs/minimal.js"`

**Symptom:** `npx wrangler deploy --dry-run` failed with ~5 esbuild errors:

```
✘ [ERROR] Could not resolve "protobufjs/minimal.js"
    node_modules/ccxt/js/src/static_dependencies/dydx-v4-client/...js
    To fix this, you can add an entry to "alias" in your Wrangler configuration.
```

**Root cause:** CCXT's base `Exchange.js` (which every exchange class extends) eagerly imports its bundled dydx-v4 client (`'../static_dependencies/dydx-v4-client/onboarding.js'`, `helpers.js`, plus a dynamic `import('../static_dependencies/dydx-v4-client/registry.js')`), and that dydx-v4 client references `protobufjs/minimal.js`. CCXT does **not** declare `protobufjs` as an npm dependency - they ship it some other way for their own build pipeline, so the import is dangling for downstream consumers.

**Workaround that worked:** Install `protobufjs` as a sibling dependency:

```bash
bun add protobufjs
```

After this, `protobufjs/minimal.js` resolves to the real package and the bundle succeeds. This pulls the entire dydx-v4 client into the Worker bundle (dead code for Lazuli since we don't use dydx), inflating the bundle but staying within Workers limits.

**Alternatives considered:**

- Importing per-exchange source files (`ccxt/js/src/binance.js`) to dodge the dydx import - **does not work** because each exchange extends `Exchange`, which itself imports dydx at the top level. The dep is unavoidable via the source path.
- Adding `rules`/`alias` to `wrangler.toml` to stub `protobufjs/minimal.js` with an empty module - plausible but not attempted since installing the real package is cleaner and the bundle size is acceptable.
- Using the prebuilt browser bundle `ccxt/dist/ccxt.browser.min.js` - not attempted; would bypass the issue entirely at the cost of losing tree-shaking.

**Bundle size impact:** `wrangler deploy --dry-run` reports `13278.33 KiB / gzip: 2176.81 KiB` (~2.1 MB gzipped). This is within the Workers free-tier limit (3 MiB compressed) and well within the paid limit (10 MiB). No `[[rules]]` or `build.command` was needed.

### Issue 2 — `TypeError: Cannot use 'in' operator to search for 'time' in ♂` (and silently empty results)

**Symptom (first run, before fix):**

- `binance.spot.loadMarkets` returned `numMarkets: 0` (call "succeeded" but parsed nothing)
- `binance.spot.fetchTickers` threw `TypeError: Cannot use 'in' operator to search for 'time' in ` followed by a garbled byte (`\u001f`, the gzip magic byte 0x1f)
- `binance.spot.fetchOHLCV` / `fetchOrderBook` threw `BadSymbol: binance does not have market symbol BTC/USDT` (consequence of markets never being loaded)
- Bybit/OKX/Hyperliquid returned suspicious or partial results

**Root cause (definitive):** Under `nodejs_compat`, `window` is undefined and `Deno` is undefined, so CCXT's platform detection (`node_modules/ccxt/js/src/base/functions/platform.js`) computes `isNode = true`. In `Exchange.fetch()`, when `isNode === true`, CCXT dynamically imports its bundled `node-fetch` (`'../static_dependencies/node-fetch/index.js'`) and uses it as `fetchImplementation`. CCXT's bundled node-fetch does **not** honor `Content-Encoding: gzip` and auto-decompress - it returns the raw gzipped bytes. Calling `.text()` on those bytes yields garbage, and parsers downstream either choke on the gzip magic byte or silently produce empty arrays.

This was confirmed with a minimal diagnostic Worker:

- Direct `await fetch('https://api.binance.com/api/v3/exchangeInfo').then(r => r.text())` returned 16.9 MB of valid JSON (the Workers native fetch DOES auto-decompress).
- The same URL through CCXT's `ex.fetchMarkets()` returned garbled bytes (visible in `wrangler dev` logs because `verbose: true` dumped the response body).

**Fix (the critical one):** Pass the Workers native `fetch` explicitly:

```ts
const exchange = new binance({
  enableRateLimit: true,
  fetchImplementation: fetch as any, // <-- THE FIX
});
```

After this one-line change, **all 14 operations succeeded with realistic data** (4427 Binance markets, 3600 tickers, 792 futures markets, 722 Hyperliquid markets, etc.).

CCXT's `fetchImplementation` option is documented as a user override (line 273 of `Exchange.js`: _"do not delete this line, it is needed for users to be able to define their own fetchImplementation"_). It is the supported way to inject a host-native fetch.

### Issue 3 (cosmetic) — Version string mismatch

CCXT's runtime `Exchange.ccxtVersion` is `4.5.58` while `package.json` reports `4.5.59`. This is a packaging artifact of CCXT's `vss.js` build step and has no runtime impact.

## 5. Workarounds Attempted (chronological)

1. ❌ Initial `wrangler deploy --dry-run` → protobufjs bundle error.
2. ❌ Tried importing per-exchange modules (`ccxt/js/src/binance.js`) → still fails because `Exchange.js` imports dydx.
3. ✅ Installed `protobufjs` as sibling dep → bundle succeeds.
4. ❌ First end-to-end run → all Binance reads failed or returned empty data (gzip not decompressed).
5. 🔍 Wrote a diagnostic Worker comparing raw `fetch()` vs CCXT's fetch → confirmed CCXT was receiving gzipped bytes; raw `fetch()` was fine.
6. ✅ Added `fetchImplementation: fetch as any` to every exchange constructor → all 14 tests pass with correct data.

## 6. CPU Time / Limits

- **No CPU-time errors observed** in local `workerd` mode.
- Total handler wall time ~19.9 s (one request, sequential operations, no parallelism). Hyperliquid's `loadMarkets` alone took 11.8 s.
- **Workers CPU limit note:** CPU time is wall-clock minus I/O wait. The biggest CPU consumers are JSON parsing (Binance `exchangeInfo` is 16.9 MB raw → 4427 markets) and the inflate step. For production on the free tier, **a single Worker request gets only 10 ms CPU (50 ms wall)** on the free plan and **up to 30 s CPU** on paid plans. The current single-request, all-exchanges pattern WILL exceed free-tier limits and likely exceeds paid-tier limits under load.
- **Recommendation for production:** split operations across multiple subrequests (Workers can issue up to 50 subrequests per request on paid, 6 on free) or, more realistically, cache `loadMarkets()` in KV/Durable Objects and only refresh periodically. Lazuli already has a background-worker pattern (per recent commits) that should map cleanly onto a scheduled Worker (`[triggers] crons`).

## 7. Performance Observations

| Operation                              | ms    | Comment                                                                                  |
| -------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `binance.spot.loadMarkets`             | 3254  | 4427 markets; dominated by 16.9 MB JSON download + parse                                 |
| `binance.spot.fetchTickers`            | 667   | 3600 tickers                                                                             |
| `binance.spot.fetchOHLCV` (24 candles) | 913   | reasonable                                                                               |
| `binance.spot.fetchOrderBook`          | 132   | fast                                                                                     |
| `bybit.spot.fetchTicker`               | 1218  | first call includes implicit markets load                                                |
| `okx.spot.fetchTickers`                | 1204  | 1260 tickers                                                                             |
| `binance.future.loadMarkets`           | 417   | 792 markets                                                                              |
| `binance.future.fetchFundingRates`     | 239   | 798 rates                                                                                |
| `hyperliquid.swap.loadMarkets`         | 11778 | **722 markets, but ~12 s** - Hyperliquid's market endpoint is chatty; cache aggressively |

## 8. Bundle Output

```
$ npx wrangler deploy --dry-run
Total Upload: 13278.33 KiB / gzip: 2176.81 KiB
```

~2.1 MB gzipped. Acceptable for Workers (3 MB free / 10 MB paid).

## 9. Missing Node.js APIs

None observed. `nodejs_compat` + the recent `compatibility_date` covered everything CCXT touched in these operations. The dydx/protobuf code paths were bundled but not exercised, so we cannot rule out issues there - however Lazuli does not use dydx.

## 10. Final Verdict

**✅ USE CCXT ON WORKERS.** Do not fall back to hand-rolled `fetch()` calls.

### Required setup (the two non-obvious bits)

1. `bun add ccxt protobufjs` - protobufjs is needed only to satisfy CCXT's dangling dydx-v4 import at bundle time.
2. Construct every exchange with `fetchImplementation: fetch`:
   ```ts
   new binance({ enableRateLimit: true, fetchImplementation: fetch as any });
   ```
   Without this, CCXT picks its bundled node-fetch (because `isNode === true` under `nodejs_compat`) and gzip responses are not decompressed, silently breaking every read.

### Caveats

- **Bundle size** is ~2.1 MB gzipped. Within limits, but not small. If this becomes a problem, options are: (a) tree-shake by importing only the exchanges you need from the prebuilt browser bundle, (b) split into multiple Workers, or (c) live with it.
- **CPU limits** on the Workers free tier (10 ms CPU/request) will be exceeded by Binance `loadMarkets` alone. Plan for the paid tier and/or move `loadMarkets` into a scheduled Worker that writes to KV/Durable Objects, with the request path reading from cache.
- **Hyperliquid `loadMarkets` is slow** (~12 s). Cache its markets the same way as Binance.
- **`enableRateLimit: true` works** because rate limiting is in-process per isolate. For multi-isolate correctness, consider external coordination (e.g., a Durable Object as the rate-limit authority) if you find yourself getting rate-limited.
- **Dead code warning:** the dydx-v4 client is now in your bundle. Harmless but bloated. Could be eliminated upstream by asking CCXT to declare `protobufjs` as a real dependency, or by using `wrangler.toml` `[[rules]]` to alias it to a stub if bundle size becomes painful.
- **Not tested in this spike (out of scope, but worth a follow-up):** authenticated/private endpoints (`fetchBalance`, `createOrder`), WebSocket streams (`watchTicker` etc. - these almost certainly need different handling on Workers), and any exchange that requires CCXT's Node-only crypto paths beyond what `nodejs_compat` provides. The public-read paths Lazuli relies on today all work.

## 11. Artifacts Left In Place

Per task instructions, the spike directory was NOT deleted. Files of interest:

- `spike-ccxt-worker/wrangler.toml` - Worker config
- `spike-ccxt-worker/src/index.ts` - Final working probe source (with `fetchImplementation: fetch` fix applied)
- `spike-ccxt-worker/package.json` - Pinned dependency versions
- `spike-ccxt-worker/dev.log` - Full `wrangler dev` log including the gzipped-byte evidence from the failed first run
- `spike-ccxt-worker/final-response-clean.json` - The full JSON response from the successful 14/14 run
- `spike-ccxt-worker/.build-dryrun/` - Output of `wrangler deploy --dry-run` (proves bundling works)
