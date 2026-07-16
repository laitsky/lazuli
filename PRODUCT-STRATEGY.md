# Lazuli — Product Strategy & 90-Day Build Plan

> **Vision:** The real-time, all-in-one crypto market intelligence platform — Coinglass's depth, Laevitas's institutional intelligence, delivered at the edge with push alerts nobody else offers. Free.

> **Current milestone: Beta (`0.1.0-beta.0`, declared 2026-07-16).** Beta means the product implementation and automated CI baseline are ready for controlled evaluation with feature flags and documented fallbacks. It does **not** mean the 2,000-client gate, reconnect storm, 72-hour soak, provider-delivery acceptance, production rollout windows, or 26/26 production verification have passed. Production remains unauthorized and the strategy ledger remains `partial=26`. See the [beta declaration](docs/releases/0.1.0-beta.0.md).

## 1. Strategic Positioning

| Competitor    | Moat                                                      | Weakness                                                            | Price  | Our Answer                                    |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------- | ------ | --------------------------------------------- |
| **Coinglass** | Liquidation heatmaps, macro sentiment, brand              | Glitchy/delayed data, black-box aggregation, passive (you check it) | $28/mo | Edge-native real-time + push alerts           |
| **Coinalyze** | CVD, order flow, footprint                                | Steep learning curve, niche, not all-in-one                         | $11/mo | Same depth inside one unified platform        |
| **Laevitas**  | Options Greeks, vol surfaces, term structure, backtesting | Inaccessible, institutional-only                                    | $50/mo | Free institutional layer (already half-built) |

**Unfair advantages we hold:**

1. Edge-native on Cloudflare → lowest-latency real-time layer (architecturally hard to copy).
2. We already ship the "free Laevitas" — ETF flows + Deribit options + confluence.
3. Hyperliquid (DEX) integration — under-covered by legacy aggregators.
4. A real historical OHLCV archive in R2 — backtesting infra cost already paid.

**One-sentence strategy:** Ship the real-time liquidation radar + push alerts as the wedge, compound with free institutional depth (Greeks + backtesting), and grow via viral snapshots + SEO — all enabled by agent parallelization that lets one builder ship like a team.

**Completion evidence:** The versioned [strategy completion ledger](docs/strategy/completion-ledger.json) tracks A0–E5 against the six production-completion conditions. An item is complete only when its implementation, tests, production enablement, observability, recovery, and strategy evidence pass the machine-checked gate documented in [the ledger guide](docs/strategy/README.md). Beta status is a release channel, not a waiver or substitute for this contract.

---

## 2. Success Metrics (90 days)

| Metric                         | Target               | Why it matters                  |
| ------------------------------ | -------------------- | ------------------------------- |
| WAU (weekly active users)      | Define baseline → 3× | Top-of-funnel growth            |
| Push-alert subscribers         | 5,000                | Retention loop + DAU driver     |
| Concurrent WS connections      | 2,000 peak           | Engagement signal               |
| API keys issued                | 1,000                | Builder/quants acquisition      |
| Organic SEO landings           | 50k visits/mo        | Free acquisition flywheel       |
| Backtest runs / week           | 10,000               | Depth-feature engagement        |
| Liquidation-feed latency (p95) | < 800 ms             | The explicit wedge vs Coinglass |

These are measured product outcomes, not code-completion gates. A0–E5 completion requires working production instrumentation for the relevant metrics, but does not wait for adoption targets such as 5,000 subscribers or 50,000 monthly SEO visits to be reached.

---

## 3. Prioritized Backlog (RICE-style)

_Reach × Impact × Confidence ÷ Effort. Scores relative._

| #     | Feature                                 | R   | I   | C   | E   | Score               | Track |
| ----- | --------------------------------------- | --- | --- | --- | --- | ------------------- | ----- |
| A1+A3 | Liquidation radar + push alerts         | 5   | 3   | .9  | M   | **Highest**         | A     |
| A0    | WebSocket broker (DO pub/sub)           | 5   | 3   | .9  | S   | Highest (enabler)   | A     |
| D3    | Viral shareable snapshots + OG images   | 4   | 2   | .9  | S   | Very high           | D     |
| D6    | SEO landing pages (per-symbol/exchange) | 5   | 2   | .8  | S   | Very high           | D     |
| E2    | Wire `price_alerts` table + event bus   | 4   | 3   | .9  | S   | Very high (enabler) | E     |
| B2    | Backtesting engine (on R2 archive)      | 3   | 3   | .8  | M   | High                | B     |
| E3    | Options Greeks compute (Black-Scholes)  | 2   | 2   | .95 | S   | High                | E/B   |
| A5    | OI-weighted funding + OI-spike radar    | 3   | 2   | .85 | S   | High                | A     |
| B3    | Server-side Signal Lab + persistence    | 3   | 2   | .8  | M   | High                | C     |
| B1    | CVD / order-flow / footprint            | 2   | 3   | .7  | L   | Med-high            | B     |
| D1+D2 | Accounts + saved configs                | 4   | 2   | .9  | L   | Med-high            | D     |
| B4    | Options term structure + vol surface    | 1   | 2   | .8  | M   | Med                 | B     |
| B5    | Confluence macro expansion              | 2   | 1   | .8  | S   | Med                 | C     |
| D5    | Public API keys + docs                  | 2   | 2   | .9  | S   | Med                 | D     |

---

## 4. Execution Plan — 5 Parallel Tracks

### Track A — Real-Time Engine (the Coinglass wedge)

| ID  | Item                                                          | Deps | Deliverable                |
| --- | ------------------------------------------------------------- | ---- | -------------------------- |
| A0  | WS broker: DO pub/sub + `/ws` endpoint                        | —    | Foundation for A1/A4/B1    |
| A1  | Liquidation engine: level math from perp OI + mark + leverage | A0   | Live cascade feed          |
| A2  | Liquidation heatmap UI (Market Workspace overlay)             | A1   | Killer visual              |
| A3  | Push alerts: Telegram/Discord/Webhook/Email → event bus       | E2   | Retention loop             |
| A4  | Public WS endpoints: tickers, liquidations, OB deltas, alerts | A0   | Latency moat               |
| A5  | OI-weighted funding + OI-spike radar                          | —    | Pro-requested, underserved |

### Track B — Derivatives Depth (Laevitas + Coinalyze killer, free)

| ID  | Item                                                       | Deps | Deliverable                              |
| --- | ---------------------------------------------------------- | ---- | ---------------------------------------- |
| B1  | CVD / order-flow / footprint from trade-tape WS            | A0   | Coinalyze moat                           |
| B2  | Backtesting engine on R2 OHLCV                             | E4   | Equity curve, drawdown, Sharpe, win-rate |
| B3  | Server-side Signal Lab + versioning + auto-backtest        | B2   | Signals stop vanishing                   |
| B4  | Options term structure + vol surface                       | E3   | ATM IV curve, skew, walls                |
| B5  | Confluence macro: + BTC.D, stablecoin supply, Fear & Greed | —    | True regime model                        |

### Track C — Intelligence Layer (sharpen existing blades)

| ID  | Item                                                                  | Target file            | Deliverable            |
| --- | --------------------------------------------------------------------- | ---------------------- | ---------------------- |
| C1  | Screener: +technical (RSI/breakout) +derivatives (funding/OI) filters | `index.ts:481`         | Multi-dimensional scan |
| C2  | Funding arbitrage: +basis-curve history +execution-cost yield         | `index.ts:636`         | Realistic yield        |
| C3  | Market Workspace: +liquidation & CVD overlays                         | `market-workspace.tsx` | Unified cockpit        |
| C4  | Trending/volume-spike detector (24h-vs-7d ratio)                      | `index.ts:194`         | Discovery feed         |

### Track D — Growth & Retention (free flywheel)

| ID  | Item                                           | Deps   | Deliverable                        |
| --- | ---------------------------------------------- | ------ | ---------------------------------- |
| D1  | Accounts + auth (magic-link/passkey)           | —      | Persistence backbone               |
| D2  | Saved workspaces/watchlists/alerts/backtests   | D1, E2 | Switching cost                     |
| D3  | Viral snapshots + OG-image generation          | —      | `lib/screenshot.ts` already exists |
| D4  | Public "Alpha Feed" (top signals/alerts)       | B3     | Acquisition loop + SEO             |
| D5  | API keys + public API docs                     | —      | Capture builders/quants            |
| D6  | SEO landing pages (per-symbol/exchange/signal) | —      | Massive free acquisition           |

### Track E — Foundation (unblocks all, ship first)

| ID  | Item                                                                    | Target                        | Deliverable                        |
| --- | ----------------------------------------------------------------------- | ----------------------------- | ---------------------------------- |
| E1  | Rewrite stale docs (`AGENTS.md`, `TODO.md`, `api-spec.yaml`)            | root                          | Stop shipping on wrong assumptions |
| E2  | Wire dead `price_alerts` table + event-bus skeleton                     | `0001_initial_schema.sql`     | Alerting backbone                  |
| E3  | Compute options Greeks from Deribit IV (Black-Scholes)                  | `institutionalService.ts:675` | Fill null Greeks                   |
| E4  | Fix backfill window (2019→2020) → full available; backfill top 50 pairs | `backfillService.ts:79`       | Real history                       |
| E5  | Binance: re-enable or document geo-handling                             | `index.ts:106`                | Biggest exchange unblocked         |

---

## 5. Phasing & Critical Path

```
Week 1-3   E1 ‖ E2 ‖ E3 ‖ E4 ‖ E5 ‖ A0          (6 agents fan out)
Week 3-7   A1 ‖ A3 ‖ A4 ‖ A5 ‖ A2(UI)             Track A
Week 5-10  B1 ‖ B2 ‖ B3 ‖ B4 ‖ B5                 Track B  (parallel with A)
Week 7-11  D1 ‖ D2 ‖ D3 ‖ D4 ‖ D5 ‖ D6            Track D  (parallel)
Week 10-12 C1-C4 polish, perf hardening, launch
```

**True critical path (must sequence):**

`A0 → A1 / B1` · `E3 → B4` · `E4 → B2` · `E2 → A3 / D2` · `D1 → D2`

Everything else parallelizes — that's where agent fan-out wins.

**Phase milestones:**

- _Wk 3:_ Live WS broker + alerting backbone + working Greeks + real history.
- _Wk 7:_ Faster than Coinglass, and it pushes to your phone.
- _Wk 10:_ Institutional depth, zero paywall.
- _Wk 12:_ Retention loop compounding.

---

## 6. Improve Existing Features (concrete targets)

| Existing feature | Current gap                                 | Fix                                               |
| ---------------- | ------------------------------------------- | ------------------------------------------------- |
| Signal Lab       | 100% client-side, signals vanish on refresh | Migrate server-side (B3); persist + auto-backtest |
| Options          | Greeks always null                          | Black-Scholes from IV (E3)                        |
| Alerts           | `price_alerts` table exists, never used     | Wire CRUD + delivery (E2, A3)                     |
| Funding arb      | Point-in-time yield only                    | Basis-curve history + cost-adjusted yield (C2)    |
| Screener         | Volume/change filters only                  | +technical & +derivatives dimensions (C1)         |
| Confluence       | 6 signals, no macro regime                  | +BTC.D, stablecoin supply, Fear & Greed (B5)      |
| History          | Backfill window fixed at 2019-2020          | Full available history (E4)                       |
| Docs             | AGENTS.md/TODO/api-spec misrepresent stack  | Regenerate from live code (E1)                    |

---

## 7. Risk Register

| Risk                                    | Likelihood | Impact | Mitigation                                                                                                           |
| --------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| WS cost on Cloudflare at scale          | Med        | High   | DO hibernation + connection pooling; monitor concurrent-conn billing                                                 |
| Liquidation accuracy questioned         | Med        | High   | **Transparency over black-box** (explicitly anti-Coinglass): document the model, show assumptions, label "estimated" |
| Exchange rate limits during backfill    | High       | Med    | Queue-based backfill already exists; throttle + resume                                                               |
| Data-provider outages (Farside/Deribit) | Med        | Med    | Already have snapshot/fallback degradation + provider-status flags                                                   |
| Free-first = no revenue pressure        | Med        | Med    | Complete the free milestone first; evaluate the post-90-day glide-path in §8 separately                              |
| Agent parallelization = merge conflicts | Med        | Low    | Track ownership boundaries; atomic commits per feature                                                               |

---

## 8. Post-90-Day Monetization Glide-Path

**This 90-day milestone is entirely free:** Everything retail — all features, all data, full UI. Monetization is explicitly outside the completion boundary for A0–E5 and cannot delay or restrict their production rollout.

**Pro tier (evaluate only after the 90-day milestone is complete):**

- Higher API rate limits & WS connection cap
- Deeper backtest history (full archive vs 1yr)
- Webhook/alert quota lift
- Saved backtest portfolios, signal watch

**B2B API (post-milestone):** Paid tiers for quants/builders embedding the data layer — your strongest asset, already production-grade.

Keep retail 100% free. Any later monetization of power and programmatic use requires a separate product decision and must preserve the free growth flywheel.

---

## 9. Defensibility (why they can't just copy us)

1. **Architectural latency** — edge-native real-time; competitors must re-platform to match.
2. **Data accumulation** — R2 OHLCV archive grows in value daily; backtesting moat compounds.
3. **Network effects** — Alpha Feed + shareable snapshots create organic distribution.
4. **Switching cost** — saved workspaces/alerts/backtests (D2) lock in users over time.
5. **Breadth × depth at free** — no competitor offers all three (Coinglass breadth + Laevitas depth + real-time) at $0.

---

## 10. Next Action

Start with **Phase 1 (the 6 enablers: E1–E5 + A0)** — they unblock every downstream track and can fan out across agents immediately.
