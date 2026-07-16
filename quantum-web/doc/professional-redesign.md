# Professional Redesign — completion write-up (2026-07-16)

All five phases of `task/professional-redesign.md` are implemented. Plan and
rationale: `doc/redesign-plan.md`.

## What shipped

**Phase 1 — FT-style editorial theme**
- Token system in `src/styles.css`: paper `#FBF2E7`, warm off-black `#33302E`,
  claret `#990F3D` / oxford `#0F5499` / teal `#0D7680`, bull `#147B58` /
  bear `#A81E1E`, radii 2/4/6px, faint shadows. Display font: Source Serif 4.
- All dark machinery removed (grain, glass blur, gradients, glow); every
  component restyled. `gsap` + `embla-carousel` uninstalled; stock-fan /
  stock-carousel / hero-backdrop deleted.
- New `stock-card` grid + editorial homepage (hero, coverage grid, honest
  L1→L5 how-it-works, methodology strip, footer).
- `environment.prod.ts` filled; `fileReplacements` added.

**Phase 2 — Danelfin-style stock pages + factor sub-pages**
- `src/app/models/factors.ts` — single registry (DB column ↔ raw_output key ↔
  slug ×7) + the shared direct-score display rule (no client-side averaging).
- `/stock/:ticker/:factor` routes; `pages/factor-detail/` shows the structured
  blocks, per-block score bars, factor-specific quant charts, and the full
  round-4 Q&A reasoning chain (lazy `getFactorChain`, whitelisted JSON-path
  select on `raw_output`). Parser verified against a live PEP row:
  `{chain_1..chain_N}` strings, bracketed provenance header stripped, last
  chain = conclusion.
- Stock page rewritten: score anchor (96px gauge + headline + narrative) →
  7 factor cards → charts (factor bars, sentiment mix, score timeline,
  price+VIX) → condensed takeaways (on-page SEO text).
- `metric-charts` split by placement: stock = price+VIX; price page = risk
  stat grid + Monte Carlo + technical regime strip; financial page =
  beta / Fama-French alpha diverging bars. All FT palette.
- Score evolution: `doc/sql/analysis_score_history.sql` (view over
  stock_analyses ∪ history) + timeline chart, hidden until ≥ 2 runs.

**Phase 3 — Newsletter + About**
- `doc/sql/newsletter_subscribers.sql` — unique lower(email), RLS anon
  INSERT-only, no SELECT. `newsletter.service.ts` maps 23505 → duplicate.
- `newsletter-signup` component (idle/loading/done/duplicate/invalid/error +
  honeypot) embedded in home hero, home footer, /newsletter, /about.
- `/about` — mission, honest L1→L5 methodology, cadence, disclaimer.

**Phase 4 — SSR & SEO**
- `@angular/ssr` (NgModule + CommonEngine path). Prerendered: `/`, `/about`,
  `/newsletter`; stock + factor routes SSR at runtime. Hydration with event
  replay enabled.
- `seo.service.ts` — per-route title/description/canonical/OG + JSON-LD
  (WebSite+Organization on home, Article on stock, BreadcrumbList on factor,
  noindex on not-found).
- `public/robots.txt` + Express `GET /sitemap.xml` (all pages incl. 7 factor
  URLs per ticker, lastmod from run_at, 1h in-memory cache).

**Phase 5 — Logos**
- `public/data/sp500-logos.json` (override map) + `logo.service.ts` chain:
  `stock.logo_url` → JSON override → financialmodelingprep pattern → monogram
  fallback in consumers (stock-card, stock page infobox).

## SSR lessons (important for future work)

1. **supabase-js hangs SSR** unless created with
   `auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }` —
   GoTrue timers keep the app unstable forever (this also crashed prerender
   workers with an opaque `[object Object]`).
2. **Zone.js cannot see Node's native fetch (undici)** — supabase reads are
   invisible to SSR stability, so renders raced the network. Fix:
   `PendingTasks.add()` around every read in `SupabaseService.cached()`
   (also gives TransferState SSR→hydration handoff, no double-fetch).
3. **CommonEngine v19.2 requires `allowedHosts`** — we render with a fixed
   origin (`SITE_ORIGIN` in `server.ts`) and never trust the Host header.
4. Routed components must **await their initial load in `ngOnInit`**
   (snapshot first, subscribe for subsequent param changes) or SSR captures
   the loading state.

## Deploy

```
npm run build                                   # prerenders static routes
PORT=4000 node dist/quantum-web/server/server.mjs
```
`SITE_ORIGIN` in `src/server.ts` and `ORIGIN` in `seo.service.ts` are set to
`https://stockbar.app` — update both if the domain differs.

## User actions still required

1. Run `doc/sql/newsletter_subscribers.sql` in the Supabase SQL editor
   (signup form returns "error" until then).
2. Run `doc/sql/analysis_score_history.sql` (timeline appears once a stock
   has ≥ 2 runs).

## Future n8n follow-ups (out of scope here)

- Structurer prompt: emit an explicit per-factor `{score, sentiment}` overall
  block so factor cards read it 1:1 (today: conclusion-block heuristic).
- Wire `newsletter_subscribers` into the Brevo "Stock Bar Daily" send
  (service_role read) — replaces hardcoded recipients.
- Persist L1–L3 rounds if we ever want to show more than round-4 chains.
- Populate `stock_analyses` for all covered tickers (AAPL/MSFT/PLTR/TSLA had
  no/partial rows on 2026-07-16 — factor pages show "no chain stored").
