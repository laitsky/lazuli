# Brand — Lazuli

_Status: active_

**Lazuli** — Real-time multi-exchange market intelligence for the sovereign trader.

## Identity

Named after lapis lazuli, the deep-blue gemstone prized for millennia as a pigment of significance. The brand carries that same weight: a precision instrument, not a casino app. TradingView × Linear hybrid — dense where it counts, breathable where it helps. No marketing fluff, no glow FX, no AI-demo tells. Every pixel earns its place.

- **Category**: infra/data — professional trading tooling
- **Mood**: serious · technical · premium · bold
- **Reference brands**: TradingView, Linear, Bloomberg Terminal, Vercel

## Palette — "Lapis Signal"

Refined deep-navy base with lapis-blue primary. Three surface elevations for depth without shadows. Semantic up/down colors follow industry standard (emerald up, coral down) so traders read the screen at a glance.

### Seeds (OKLCH)

```
bg-base:       oklch(0.14 0.02 250)   /* deep navy */
bg-elevated:   oklch(0.17 0.02 250)   /* card surface */
primary:       oklch(0.62 0.18 250)   /* lapis blue */
primary-soft:  oklchch(0.40 0.10 250) /* muted lapis */
fg-base:       oklch(0.96 0.01 240)   /* off-white */
```

### Full token set — Dark mode (primary experience)

```
--background:           hsl(222 47% 6%)      /* page */
--foreground:           hsl(210 40% 96%)     /* primary text */

--surface-0:            hsl(222 47% 6%)      /* page bg */
--surface-1:            hsl(222 40% 9%)      /* card */
--surface-2:            hsl(222 35% 12%)     /* elevated / popover */

--muted:                hsl(222 30% 14%)
--muted-foreground:     hsl(215 16% 60%)     /* AA on surface-1: 4.7:1 */

--accent:               hsl(220 70% 55%)     /* per data-accent attribute */
--accent-foreground:    hsl(210 40% 98%)
--accent-subtle:        hsla(220, 70%, 55%, 0.1)

--success / up:         hsl(152 60% 45%)     /* emerald — AA on surface-1: 4.6:1 */
--destructive / down:   hsl(0 72% 58%)       /* coral — AA on surface-1: 4.8:1 */
--warning:              hsl(45 90% 55%)      /* amber — for stale data */
--info:                 hsl(200 85% 55%)     /* sky — for neutral info */

--fresh:                hsl(152 60% 45%)     /* <30s */
--stale:                hsl(45 90% 55%)      /* >60s */
--dead:                 hsl(0 72% 58%)       /* exchange unavailable */

--border:               hsl(222 18% 18%)     /* hairline */
--border-strong:        hsl(222 20% 26%)     /* active / hover */
--input:                hsl(222 30% 12%)
--ring:                 hsl(220 70% 55%)

--radius-sm:            4px
--radius:               6px
--radius-lg:            8px
--radius-xl:            12px  /* reserved for marketing surfaces only */
```

### Accent variants (user-selectable via `data-accent` on `<html>`)

```
[data-accent="lapis"]   --accent: hsl(220 70% 55%)  /* default */
[data-accent="amber"]   --accent: hsl(38 92% 55%)
[data-accent="emerald"] --accent: hsl(152 60% 45%)
[data-accent="magenta"] --accent: hsl(320 75% 60%)
```

Each variant re-derives `--accent-foreground` and `--accent-subtle` from the same hue. Semantic up/down colors are NOT affected by accent choice — they stay industry-standard emerald/coral always.

### Light mode

Not supported. Lazuli is dark-first by design — committing fully to one perfect dark theme.

## Typography

| Role    | Family            | Source                  | Use                                                                      |
| ------- | ----------------- | ----------------------- | ------------------------------------------------------------------------ |
| Display | **Clash Display** | Local woff2 (`/fonts/`) | Hero numbers (BTC price, page H1). Max `text-5xl`.                       |
| Body    | **Outfit**        | Google Fonts            | UI labels, descriptions, prose. 14/15px base.                            |
| Mono    | **Fira Code**     | Google Fonts            | All numbers, prices, percentages, symbols, code. Tabular-nums always on. |

Loaded with `font-display: swap` and preconnect. `font-feature-settings: "zero", "ss01"` on mono for slashed zeros (trading-critical — distinguishes `0` from `O`).

Type scale tightened:

- Display: 24/32/40/48 px (`text-3xl` to `text-5xl`)
- Body: 13/14/15/17 px
- Mono: 11/12/13/14 px (denser — most data is mono)

## Voice

**Technical. Precise. Confident.** Written like a Bloomberg terminal, not a fintech ad.

- "BTC up 2.4%" not "Bitcoin is on the move!"
- "3 arbitrage opportunities > 25 bps" not "Great arbitrage opportunities waiting for you"
- "Stale — exchange unavailable" not "We're having trouble reaching the exchange"
- Active voice always. Short sentences. Numbers over adjectives.
- No emoji. No exclamation points (except in true alerts). No marketing copy in product UI.

## Usage

**Do**

- Pair mono numbers with Outfit labels (e.g. `Last Price` label + `61,253.0` value)
- Use surface elevations (0/1/2) to communicate hierarchy, not shadows
- Reserve accent color for interactive emphasis only — links, active states, CTAs
- Hairline borders (`1px`) everywhere; `2px` only for active/focus
- Tabular-nums on every numeric column

**Don't**

- Use glow effects, blur overlays, or animated gradients — these are AI-demo tells
- Mix display font with body font for the same content type
- Apply accent color to non-interactive elements (it signals "click me")
- Use rounded-xl (12px) on data-dense UI — too consumer-app
- Show a price without its 24h delta when both are available

## Application

- Design tokens live in `apps/web/src/styles/tokens.css`
- consumed via Tailwind v4 `@theme` block in `globals.css`
- Accent variants via `[data-accent]` on `<html>` element
- All new components must use tokens — no hardcoded colors outside `tokens.css`
