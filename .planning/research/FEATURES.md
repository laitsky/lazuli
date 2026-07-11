# Feature Research

**Domain:** Edge-native crypto market intelligence platform (liquidations, derivatives analytics, push alerts)
**Researched:** 2026-07-11
**Confidence:** HIGH — domain is well-defined; competitor feature sets are public; requirements are explicit in PROJECT.md

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature                                  | Why Expected                                                               | Complexity | Notes                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| Real-time price tickers (multi-exchange) | Every crypto tool shows prices; absence is disqualifying                   | LOW        | CCXT already integrated; A4 WebSocket endpoint completes this             |
| Live liquidation feed                    | Core differentiation claim; users arrive specifically for this             | MEDIUM     | Requires A0 (WS broker) + A1 (liquidation engine)                         |
| Funding rate display                     | Perp traders check funding before every trade; Coinglass shows it          | LOW        | A5 adds OI-weighted aggregation on top of raw display                     |
| Open interest by symbol                  | Standard perp dashboard metric; present on all three competitors           | LOW        | Part of A5 scope                                                          |
| Liquidation heatmap                      | Coinglass's signature visual; users expect it from any liquidation product | HIGH       | A2 — heatmap math is the hard part; the overlay wiring is straightforward |
| Multi-exchange aggregation               | Single-exchange tools feel limited; users want cross-exchange view         | MEDIUM     | CCXT handles normalization; data merge logic needed                       |
| Symbol search / watchlist                | Navigation primitive; without it the product can't be explored             | LOW        | Watchlist is D2 (account-gated); search must work anonymously             |
| Mobile-accessible alerts                 | Push notification to phone is the stated core value                        | MEDIUM     | A3 — Telegram/Discord/Webhook covers this without native app              |
| Historical OHLCV charts                  | Baseline for any trading tool; backtesting requires it                     | MEDIUM     | R2 archive + E4 backfill; chart rendering in frontend                     |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valued.

| Feature                                      | Value Proposition                                                                                | Complexity | Notes                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| Sub-800ms liquidation alerts                 | Coinglass refreshes ~5–15s; edge-native WS delivery is architecturally faster                    | HIGH       | Latency moat is real only if A0→A1→A3 pipeline is measured end-to-end; KPI required |
| Free forever (no paywall)                    | Coinglass $28/mo, Laevitas $50/mo — zero cost removes the single biggest friction                | LOW        | Product decision, not engineering; enforce by deferring monetization to Wk 10+      |
| Options Greeks (delta/gamma/vega/theta)      | Laevitas charges $50/mo for this; Coinglass doesn't offer it                                     | MEDIUM     | E3 — Black-Scholes from Deribit IV; accurate enough for retail, ships in days       |
| Vol surface + term structure                 | Institutional-grade options view, currently paywalled everywhere                                 | HIGH       | B4 depends on E3; ATM IV curve + skew + put/call walls                              |
| CVD / cumulative volume delta                | Order-flow intelligence; Coinalyze offers it but UX is steep                                     | HIGH       | B1 depends on A0 trade-tape stream                                                  |
| Server-side Signal Lab (persisted backtests) | Retail traders build signals manually; server-side persistence + auto-backtest on save is unique | HIGH       | B3 depends on B2; survives browser refresh — this is the stickiness feature         |
| Backtesting engine on R2 archive             | Most tools show indicators but not backtest results inline                                       | HIGH       | B2 depends on E4; equity curve, Sharpe, max drawdown, win-rate                      |
| Cascade liquidation math                     | Not just "total liq" but which price levels trigger cascades — actionable, not decorative        | HIGH       | A1 — perp OI + mark price + leverage distribution per exchange                      |
| Shareable snapshots with OG images           | Viral growth driver; screenshot infra already exists                                             | LOW        | D3 — mostly routing + meta tags; lib/screenshot.ts is built                         |
| Public Alpha Feed (SEO + RSS)                | Discoverability via search + feed readers; competitors don't expose this                         | MEDIUM     | D4 — signals/alerts as indexable stream; drives organic traffic                     |
| API key issuance                             | Enables algo traders and devs to build on Lazuli data; creates B2B monetization path post-90d    | MEDIUM     | D5 — key issuance + docs; target 1,000 keys instrumented                            |
| Funding arbitrage with execution costs       | Basis-curve history + net yield after fees; Coinalyze shows raw funding, not net                 | MEDIUM     | C2 — extends A5 funding data with basis history                                     |
| Macro confluence (BTC.D, stablecoin, F&G)    | Helps traders frame micro data in macro context; differentiates from pure perp tools             | LOW        | B5 — CoinGecko Fear & Greed + on-chain public endpoints; low implementation cost    |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature                                                       | Why Requested                            | Why Problematic                                                                                                                                           | Alternative                                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Native mobile app (iOS/Android)                               | Users want alerts on their phone         | Separate release track, App Store review delays, additional codebase to maintain; push alerts via Telegram/Discord solve the problem without the overhead | Push alerts via Telegram, Discord, Webhook + mobile-responsive web                                                             |
| Password authentication                                       | Familiar; users expect it                | Password database is liability; bcrypt infra maintenance; credential stuffing attack surface                                                              | Magic-link + passkey — eliminates password storage entirely                                                                    |
| Real-time options pricing beyond Black-Scholes (SABR, Heston) | More "accurate" stochastic models        | Weeks of implementation vs days for B-S; Deribit already provides IV so B-S is accurate for retail use; over-engineering before validating demand         | Black-Scholes from Deribit IV (E3); revisit stochastic models if B4 validates options user base                                |
| Self-hosted / bring-your-own-cloud                            | Power users and enterprise want control  | Durable Objects, R2, D1 are load-bearing Cloudflare primitives; abstracting them away doubles architecture surface area                                   | Expose public API (D5) for users who want to integrate into their own systems                                                  |
| Full exchange pair catalog backfill                           | "More data is better"                    | Saturates Queue budget; top 50 pairs cover 95%+ of backtest queries; the long tail has negligible demand                                                  | Top-50 backfill (E4); on-demand backfill for additional pairs can be a post-90d feature                                        |
| Real-time social sentiment (Twitter/Reddit)                   | Traders want narrative context           | Paid API (Twitter $100+/mo); scraping is unreliable and ToS-risky; sentiment signal quality is low for actionable trades                                  | Fear & Greed index (free, CoinGecko) covers macro sentiment adequately; BTC.D and stablecoin supply cover structural sentiment |
| Copy trading / trade execution                                | Users want to act on signals in-platform | Brokerage licensing, exchange API key management, liability; completely out of scope for intelligence platform                                            | Shareable signals (D3, D4); let users execute via their own exchange accounts                                                  |
| Paid tiers before Wk 10                                       | Revenue                                  | Paywall before PMF kills growth flywheel; 5,000 alert subscribers and 50k/mo organic landings are more valuable than early revenue                        | Instrument KPIs, prove retention, then introduce pro tier post-90d                                                             |

---

## Feature Dependencies

```
E2 (event-bus wired)
    └──required by──> A3 (push alert delivery)
    └──required by──> D2 (saved alerts tied to account)

A0 (WebSocket broker DO)
    └──required by──> A1 (liquidation engine)
    └──required by──> A4 (public WS endpoints)
    └──required by──> B1 (CVD / order-flow)

A1 (liquidation engine)
    └──required by──> A2 (liquidation heatmap UI)
    └──required by──> A3 (push alert delivery — needs liq events)

E3 (options Greeks computed)
    └──required by──> B4 (vol surface + term structure)

E4 (backfill window fixed, top-50 pairs)
    └──required by──> B2 (backtesting engine)

B2 (backtesting engine)
    └──required by──> B3 (Signal Lab with auto-backtest on save)

D1 (accounts + auth)
    └──required by──> D2 (saved workspaces, watchlists, alerts, backtests)
    └──required by──> D5 (API key issuance — needs identity)

A5 (OI-weighted funding aggregation)
    └──enhances──> C2 (funding arbitrage with basis-curve history)

B1 (CVD / order-flow)
    └──enhances──> C3 (Market Workspace unified cockpit)

A2 (liquidation heatmap)
    └──enhances──> C3 (Market Workspace unified cockpit)

C1 (screener) ──depends on──> A5 (funding rate), B1 (CVD/OI data)
```

### Dependency Notes

- **A3 requires A0 + E2:** Alert delivery needs both the event-bus (E2) to emit liq events and the WS broker (A0) to propagate them; missing either means alerts either don't fire or can't be routed to subscribers.
- **B2 requires E4:** Backtesting is useless without a correct historical archive; E4's broken 2019–2020 cap means backtests on that window return garbage; fix the cap before building the engine.
- **B3 requires B2:** Signal Lab's auto-backtest-on-save is only valuable if the backtesting engine produces correct results; B3 without B2 is just a code editor.
- **D2 requires D1 + E2:** Saved alerts need an account identity (D1) and the event-bus schema (E2) to persist alert subscriptions; building D2 before either means a schema rewrite.
- **C3 (Market Workspace) is a composition feature:** It requires A1 (liq), B1 (CVD), and A5 (OI) to have shipped independently before the unified overlay makes sense; C3 is Phase 6, not Phase 2.

---

## MVP Definition

### Launch With (v1) — Phase 1–3 complete

Minimum set to validate "real-time liquidation alerts before Coinglass" claim.

- [ ] **A0: WebSocket broker** — without DO pub/sub there is no real-time anything; everything else is polling
- [ ] **E2: Event-bus wired** — dead `price_alerts` table blocks push alerts; must be live before A3
- [ ] **A1: Liquidation engine** — cascade-level math is the core product; raw liq feed without cascade levels is just noise
- [ ] **A3: Push alerts (Telegram/Discord/Webhook)** — this is the stated core value; "alerts before Coinglass refreshes"; validates whether users will subscribe
- [ ] **A4: Public WebSocket endpoints** — latency moat is only real if external clients can measure it; also enables early API adopters
- [ ] **A2: Liquidation heatmap** — visual proof that Lazuli's depth exceeds Coinglass; drives retention on the web UI
- [ ] **KPI instrumentation** — push-alert subscriber count + p95 latency; without this there's no signal for what to build next

### Add After Validation (v1.x) — Phase 4–5

Add once alert subscribers confirm the latency moat is real (5,000 subscribers or p95 < 800ms confirmed).

- [ ] **B1: CVD / order-flow** — adds derivatives intelligence layer; trigger: alert subscriber retention > 30-day
- [ ] **B2 + B3: Backtesting + Signal Lab** — stickiness feature; trigger: WAU baseline established from Phase 3
- [ ] **E3 + B4: Greeks + vol surface** — options traders are a separate user segment; trigger: validate interest via Alpha Feed (D4) engagement
- [ ] **D1 + D2: Accounts + persistence** — persistence unlocks saved workspaces; trigger: users asking to bookmark/share state (proxy: D3 share link usage)
- [ ] **D3: Shareable snapshots** — viral growth driver; low cost since screenshot infra exists; add early in Phase 5
- [ ] **D4 + D6: Alpha Feed + SEO pages** — organic traffic; add before organic KPI measurement begins

### Future Consideration (v2+) — Post-90 days

Defer until product-market fit is established and retention metrics justify investment.

- [ ] **Monetization / pro tier** — only after 90-day retention data; don't paywall before proving the product
- [ ] **C1: Screener with derivatives dimensions** — Phase 6 polish; valuable but not a growth driver vs alert subscriptions
- [ ] **C2: Funding arbitrage** — niche feature for carry traders; defer until user base composition is known
- [ ] **D5: API key issuance** — B2B track; defer until 1,000 key target is instrumentable; post-PMF monetization path
- [ ] **Stochastic options models (SABR/Heston)** — only if B4 vol surface validates institutional options user demand

---

## Feature Prioritization Matrix

| Feature                                 | User Value | Implementation Cost | Priority                                     |
| --------------------------------------- | ---------- | ------------------- | -------------------------------------------- |
| A0: WebSocket broker                    | HIGH       | MEDIUM              | P1                                           |
| E2: Event-bus wired                     | HIGH       | LOW                 | P1                                           |
| A1: Liquidation engine (cascade math)   | HIGH       | HIGH                | P1                                           |
| A3: Push alerts (Telegram/Discord)      | HIGH       | MEDIUM              | P1                                           |
| A4: Public WebSocket endpoints          | HIGH       | LOW                 | P1                                           |
| A2: Liquidation heatmap UI              | HIGH       | HIGH                | P1                                           |
| E3: Options Greeks (Black-Scholes)      | HIGH       | LOW                 | P1                                           |
| E4: Backfill window fix (top-50)        | MEDIUM     | MEDIUM              | P1                                           |
| E5: Binance geo-handling                | HIGH       | LOW                 | P1 — blockers must be resolved, not deferred |
| A5: OI-weighted funding aggregation     | MEDIUM     | MEDIUM              | P2                                           |
| B1: CVD / order-flow                    | HIGH       | HIGH                | P2                                           |
| B4: Vol surface + term structure        | HIGH       | HIGH                | P2                                           |
| D1: Accounts + magic-link/passkey auth  | MEDIUM     | MEDIUM              | P2                                           |
| D2: Saved workspaces + watchlists       | MEDIUM     | MEDIUM              | P2                                           |
| D3: Shareable snapshots + OG images     | MEDIUM     | LOW                 | P2 — screenshot infra already built          |
| D4: Public Alpha Feed (SEO + RSS)       | MEDIUM     | MEDIUM              | P2                                           |
| B2: Backtesting engine                  | HIGH       | HIGH                | P2                                           |
| B3: Signal Lab (server-side, versioned) | HIGH       | HIGH                | P2                                           |
| B5: Macro confluence (BTC.D, F&G)       | MEDIUM     | LOW                 | P2                                           |
| C3: Market Workspace unified cockpit    | HIGH       | MEDIUM              | P2 — composition of Phase 2–4 features       |
| C1: Screener (RSI + derivatives dims)   | MEDIUM     | MEDIUM              | P3                                           |
| C2: Funding arbitrage (basis curve)     | MEDIUM     | MEDIUM              | P3                                           |
| C4: Trending / volume-spike detector    | MEDIUM     | LOW                 | P3                                           |
| D5: API key issuance                    | MEDIUM     | MEDIUM              | P3                                           |
| D6: SEO landing pages per symbol        | MEDIUM     | HIGH                | P3                                           |

**Priority key:**

- P1: Must have for MVP (Phases 1–3); product fails its core promise without these
- P2: Should have; builds retention and derivative user segments (Phases 4–5)
- P3: Nice to have; growth polish and B2B hooks (Phase 6 + post-90d)

---

## Competitor Feature Analysis

| Feature                    | Coinglass ($28/mo)              | Coinalyze ($11/mo) | Laevitas ($50/mo) | Lazuli Approach                                                                   |
| -------------------------- | ------------------------------- | ------------------ | ----------------- | --------------------------------------------------------------------------------- |
| Liquidation feed           | Yes — 5–15s delay, paginated UI | Yes                | Limited           | Real-time WS < 800ms p95; cascade-level math (A1)                                 |
| Liquidation heatmap        | Yes — their signature           | No                 | No                | A2 — overlay on Market Workspace; matches depth, beats latency                    |
| Open interest              | Yes                             | Yes                | Yes               | A5 — OI-weighted, cross-exchange aggregate with spike radar                       |
| Funding rates              | Yes                             | Yes                | Yes               | A5 — OI-weighted aggregation; C2 adds execution-cost-adjusted yield               |
| Options Greeks             | No                              | No                 | Yes — paywalled   | E3 — Black-Scholes from Deribit IV; free forever                                  |
| Vol surface                | No                              | No                 | Yes — $50/mo      | B4 — ATM IV curve, skew, walls; depends E3                                        |
| CVD / order-flow           | No                              | Yes — steep UX     | Limited           | B1 — computed from trade-tape; cleaner UX than Coinalyze                          |
| Backtesting                | No                              | Limited            | No                | B2 — full equity curve, Sharpe, drawdown on R2 archive                            |
| Signal Lab                 | No                              | No                 | No                | B3 — unique; server-side versioned signals with auto-backtest; stickiness feature |
| Push alerts                | Basic (email only, paid)        | No                 | No                | A3 — Telegram, Discord, Webhook, Email; free                                      |
| API access                 | Yes — paid tier                 | Limited            | Yes — expensive   | D5 — free tier, key-gated; monetization hook post-90d                             |
| Saved workspaces           | Yes — paid                      | No                 | Yes — paid        | D2 — free with account (D1)                                                       |
| Shareable snapshots        | No                              | No                 | No                | D3 — viral growth driver; screenshot infra already exists                         |
| SEO / content pages        | Minimal                         | No                 | No                | D4 + D6 — Alpha Feed + per-symbol landing pages                                   |
| Macro context (BTC.D, F&G) | BTC.D only                      | No                 | No                | B5 — BTC.D + stablecoin supply + Fear & Greed (CoinGecko free)                    |
| Mobile                     | App (paid)                      | No                 | No                | Progressive web + Telegram/Discord push; no separate app track                    |

---

## Sources

- PROJECT.md — requirements, constraints, competitor positioning (authoritative source for this project)
- Competitor analysis: Coinglass feature set (coinglass.com), Coinalyze (coinalyze.net), Laevitas (laevitas.ch) — pricing and feature gaps derived from competitor documentation
- Domain knowledge: crypto derivatives trading feature expectations are well-established in the retail trading community; table stakes derived from what all three competitors offer

---

_Feature research for: edge-native crypto market intelligence (liquidations, derivatives, push alerts)_
_Researched: 2026-07-11_
