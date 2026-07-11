# Stock·Bar Professional Redesign — FT-style theme, Danelfin-style stock pages, About/Newsletter, SSR/SEO

## Context

The current quantum-web frontend looks "playful/gamer-like": dark canvas with a neon emerald→cyan gradient, aurora blobs, a canvas particle constellation, glowing pulse dots, and a GSAP fan-deck of stock cards. The user wants a professional, FT-inspired site for a serious audience. Research on io-fund.com and danelfin.com plus the FT Origami palette informs the redesign. Key data-layer facts (verified):

- **Supabase (schema v3)** stores per stock: `summary` JSONB (headline/narrative/bullets/overall_sentiment/score), 7 factor columns (`political, price, macro, management, sentiment, competitor, financial`) each `SectionBlock[]` (heading/takeaway/body/bullets/sentiment/score), `metrics` JSONB (real quant data from the Railway yfinance API — nothing random), `raw_output` = the n8n round-4 `refined` Q&A per module (`macro, political, fs, competition, management, sentiment, price`).
- **The n8n → Supabase writer** (`CR Structurer & Supabase Writer`, ID `PJkASA0XLIV5TCka`): Webhook → Build Prompt → GPT structurer → Get Metrics (Railway `/analyze`) → Get Profile (`/profile`) → Upsert Stock (`?on_conflict=ticker`) → archive-old → insert new analysis. Rounds L1–L3 are NOT persisted anywhere — only round-4 Q&A survives in `raw_output`.
- `getAnalysis()` does NOT select `raw_output` (good — it can be fetched lazily per factor).
- No SEO infra (no Title/Meta usage, no SSR), no About/Newsletter pages, `environment.prod.ts` has placeholders and angular.json lacks `fileReplacements`.

## User decisions (fixed)

1. **Light FT-style theme** (warm paper bg, claret/oxford/teal accents, serif display font).
2. **Factor chain UI = round-4 only** — show Q&A from `raw_output`; do NOT modify the n8n pipeline in this task.
3. **S&P 500 logos** — include in plan, LOW priority (last capability).
4. **SEO = full SSR/prerender** via `@angular/ssr`.

## What we borrow from the reference sites (recommendation)

**From Financial Times** (fits: we're an editorial "wikipedia for stocks"):
- Warm paper background (`#FBF2E7`, similar-not-identical to FT `#FFF1E5`), warm off-black text `#33302E`, accents claret `#990F3D` / oxford blue `#0F5499` / teal `#0D7680`.
- Dual-voice typography: serif display (**Source Serif 4**, free analogue of Financier Display) + Inter Tight body (already used) + JetBrains Mono for numbers.
- Restrained accents, thin rules, square-ish radii, no glow/gradients.

**From Danelfin** (fits: our data is already factor-decomposed, exactly their model):
- **Single headline score as page anchor** → our `summary.score` gauge + `overall_sentiment` at top of stock page.
- **Factor decomposition with per-factor scores** → our 7 factor columns map 1:1; their "8 alpha factors with signed impact" becomes our 7 factor cards with avg score + sentiment.
- **`/stock/:ticker` templated SEO pages + title pattern** `"{Name} ({TICKER}) AI Stock Analysis | Stock Bar"` — and we go further with `/stock/:ticker/:factor` sub-pages (7× more indexable pages; Danelfin can't show reasoning chains — we can, that's our differentiator).
- Breadcrumbs, last-updated timestamp (`run_at`), related-stock links (later).

**From io-fund** (fits: newsletter goal + free-access philosophy):
- Newsletter email capture in the hero + repeated in footer (wording: **"Get free Stock Bar newsletter"**).
- Trust/methodology strip (our version: "free · verified multi-agent analysis · updated daily") instead of their paid tiers — our philosophy is free access, which becomes the About page core.
- How-it-works section describing the real L1→L5 pipeline honestly.

**NOT borrowed**: io-fund's paywall/pricing ladder (contradicts free philosophy), Danelfin's Pro-gating, FT's exact palette/fonts (trademark-adjacent).

## The 10 graphics — module-diverse, each tied to real stored analysis data

(Revised per user feedback: price-model-specific visuals move onto the Price factor page; the main stock dashboard gets module diversity. Liked & kept prominent: price chart, VIX, 7-factor bars, overall gauge.)

All read from `stock_analyses.metrics` (Railway yfinance API, refreshed each n8n run), the LLM analysis itself (`SectionBlock.score/sentiment`, `summary.score`), or a new read-only SQL view over `stock_analyses_history` (score evolution). Each hides itself when its field is null. No random/decorative data.

| # | Graphic | Module | Data source (exact field) | Placement |
|---|---------|--------|---------------------------|-----------|
| 1 | Overall AI score gauge (page anchor, Danelfin-style) | Summary | `summary.score` + `overall_sentiment` | stock page top |
| 2 | 7-factor score bar chart | All factors | per-factor score directly from analysis blocks (conclusion block if present, else block scores) | stock page |
| 3 | Sentiment mix stacked bar (pos/neu/neg blocks per factor) | All factors | `SectionBlock.sentiment` across 7 columns | stock page |
| 4 | Score evolution timeline (overall + per-factor over runs) | All factors | NEW SQL view `analysis_score_history` (run_at + scores only) over `stock_analyses_history` | stock page |
| 5 | 30-day price + Bollinger + SMA50/200 | Price | `metrics.price.last_30d_close[]`, `technicals.bollinger_bands`, `SMA_50_last/SMA_200_last` | stock page (liked) |
| 6 | VIX 30-day line (market-fear context) | Macro | `metrics.vix_levels.vix_last_30d[]` | stock page, macro context (liked) |
| 7 | Beta-vs-market + Fama-French alpha diverging bars | Financial | `metrics.factor_model.capm_beta_univariate_60m`, `fama_french_alpha_annual` | Financial factor page |
| 8 | Per-block score bars (heading + score bar + sentiment chip) — works for Political/Management/Competitor which have no quant data | Every factor | `SectionBlock.score/sentiment` per block, direct values | every factor page header |
| 9 | Monte Carlo 95% CI projection bar | Price | `metrics.monte_carlo.ci_95_lower/upper/mean_price/potential_return_pct/horizon_days` + `price.last_close` | Price factor page |
| 10 | Technical regime strip: RSI state, MACD crossover, golden/death cross, GARCH persistence | Price | `metrics.technicals.RSI/MACD`, `golden_death_cross.*`, `garch_model.persistence` | Price factor page |

Supporting stat rows (VaR, drawdown, Sharpe, volatility) stay as a compact stat grid on the Price factor page.

---

# Plan: Capabilities → Features → Epics (with checklists)

> First implementation step (project rule): write this breakdown as a checklist to `quantum-web/task/professional-redesign.md` and keep it updated; on completion write `quantum-web/doc/professional-redesign.md`.

## CAPABILITY A — Editorial FT-Style Theme *(Phase 1 — visible win first)*

### Feature A1: Design tokens & typography
**Epic A1.1 — Token system + font swap** — `src/styles.css`, `src/index.html`
- [ ] Rewrite `:root` tokens: `--bg:#FBF2E7`, `--bg-wash:#F4E8D9`, `--card:#FFFFFF`, `--text:#33302E`, `--text-2:#66605B`, `--border:rgba(51,48,46,.16)`; accents `--claret:#990F3D`, `--oxford:#0F5499`, `--teal:#0D7680`; semantic `--bull:#147B58`, `--bear:#A81E1E`; delete `--accent-grad`, `--glow`; radii → 2/4/6px; faint shadows
- [ ] Fonts: Google Fonts link → **Source Serif 4** (display) + keep Inter Tight (body) + JetBrains Mono (numbers); `--font-display:'Source Serif 4', Georgia, serif`
- [ ] `index.html` theme-color → `#FBF2E7`
- [ ] Remove dark machinery: grain overlay `body::before`, `.qp-glass`→`.qp-panel` (white, 1px border, no blur), gradient `.qp-accent-text`→solid claret; rework `.qp-btn` (claret solid / oxford ghost), `.qp-eyebrow`, `.qp-badge`, `.qp-infobox`, `.qp-section-heading` (serif + thin rule), scrollbar/selection

**Epic A1.2 — Component restyle sweep** *(after A1.1)*
- [ ] Restyle: `nav` (paper bar, thin bottom rule, remove pulse-glow keyframes), `ticker-tape` (light strip), `sentiment-chip` (no neon glow), `score-gauge` (claret/teal arc), `analysis-section` (white cards, no backdrop-filter), `dynamic-island-toc` (white island), `metric-charts` css, `home`/`stock-detail`/`app` css
- [ ] Verify: `grep -rn "34d399\|22d3ee\|07090d" src/` → empty

### Feature A2: Remove decorative machinery & dead code
**Epic A2.1 — Delete fan/carousel/particles, drop gsap + embla**
- [ ] Delete `components/stock-fan/`, `components/stock-carousel/`, `components/hero-backdrop/`; clean `app.module.ts` declarations; remove usages from `home.component.html`
- [ ] `npm uninstall gsap embla-carousel`; build green, bundle shrinks; delete stale `doc/stock-carousel.md`

**Epic A2.2 — New professional stock-card grid** *(replaces the fan)*
- [ ] Create `components/stock-card/` — white card, 1px border, 3px claret top bar, mono ticker, serif name, sector/exchange line, logo with monogram fallback (port from stock-fan), whole card = real `<a routerLink>` (crawlable)
- [ ] Home grid: `repeat(auto-fill, minmax(240px,1fr))` over existing `filtered`; declare in module

### Feature A3: Homepage editorial layout (io-fund-inspired)
**Epic A3.1 — Home rewrite** *(after A2.2; newsletter slot wired in C2)*
- [ ] Hero: serif headline, sub, search, real stats, newsletter signup slot
- [ ] Sections: coverage grid, how-it-works describing the real L1→L5 pipeline, trust/methodology strip ("free · verified · updated daily"), footer with `/about`, `/newsletter`, disclaimer

## CAPABILITY B — Stock Page Restructure (Danelfin-inspired + factor chains)

### Feature B1: Factor architecture & routing
Decision: **sub-route `/stock/:ticker/:factor`** (not accordion) — 7 extra indexable SSR pages per stock, deep-linkable from the newsletter.

**Epic B1.1 — Factor registry + routes**
- [ ] Create `src/app/models/factors.ts`: single source of truth `{key (DB column), module (raw_output key: fs→financial, competition→competitor), label, slug}` × 7
- [ ] Add route `stock/:ticker/:factor` (validate slug against registry, redirect if invalid); `stock-detail` consumes the registry instead of its local array

**Epic B1.2 — Lazy raw_output fetch + defensive Q&A parser**
- [ ] `SupabaseService.getFactorChain(stockId, moduleKey)` — PostgREST JSON-path select `raw_output->{module}` only (moduleKey from whitelist, never raw URL); do NOT add raw_output to `getAnalysis`
- [ ] First step: dump one live row's `raw_output` shape (anon query) and lock the parser to reality — the exact Q&A key shape was never captured
- [ ] `parseFactorChain()` → `{qa:[{question,answer}], conclusion}` with raw-text fallback (never render blank)

**Epic B1.3 — Factor detail page** *(after B1.1/B1.2)*
- [ ] Create `pages/factor-detail/` — breadcrumb (ticker → factor), factor score + sentiment header, structured `SectionBlock`s (reuse `analysis-section`), then "Full reasoning chain": Q1–Q5 serif question / prose answer pairs, conclusion in claret-ruled panel, prev/next factor links

**Epic B1.4 — Stock page layout rewrite (Danelfin-style)**
- [ ] Order: title+infobox → **score anchor** (big `summary.score` gauge, sentiment chip, `summary.headline` as the heading, narrative+bullets) → **7 factor cards** (new `components/factor-card/`: label, score+sentiment taken DIRECTLY from the analysis — the factor's conclusion/overall block when the structurer produced one, else the single block, else the block scores shown as-is (mini bars) with no synthetic averaging — lead takeaway, link to sub-route) → charts dashboard (B2) → condensed takeaways of full sections (keeps on-page SEO text)
- [ ] `stock-detail.component.ts`: `factorDisplay()` helper implementing the direct-value rule above; update `dynamic-island-toc` anchor ids
- [ ] Future (out of scope, note in doc): tiny structurer-prompt update in n8n so each factor emits an explicit `{score, sentiment}` overall — then cards read it 1:1

### Feature B2: The 10 module-diverse graphics (table above), FT palette
**Epic B2.1 — Restyle existing charts (price, VIX, Monte Carlo, gauge)** — replace hex colors with tokens in `metric-charts` (incl. the `#6366f1` vs `#22d3ee` inconsistency), serif titles, lighter grid
**Epic B2.2 — Split metric-charts by placement**: stock page keeps price+VIX; Monte Carlo, technical regime strip (RSI/MACD/cross/GARCH), beta/FF-alpha, and the VaR/drawdown stat grid move to the relevant factor pages (Price, Financial) — every graphic null-safe
**Epic B2.3 — New `components/analysis-charts/`** with `@Input() analysis` for factor-score bars + sentiment mix; per-block score bars component for factor page headers; big gauge lives in the score anchor
**Epic B2.4 — Score evolution timeline**: SQL view `analysis_score_history` (SECURITY INVOKER view exposing only run_at + summary/factor scores from `stock_analyses_history`, anon SELECT policy on the view path; commit SQL to `doc/sql/`) + `getScoreHistory(stockId)` in SupabaseService + line chart (overall + factor toggle); hidden until ≥2 runs exist

## CAPABILITY C — New Pages

### Feature C1: About page
**Epic C1.1** — Create `pages/about/` + route + nav/footer links
- [ ] Content: mission (free access to verified AI analysis), daily update cadence, **methodology: honest L1→L5 explanation** (L1 data retrieval → L2 per-factor QA → L3 meeting rounds 1–3 → round-4 refined chains → round-5 summary → structurer), data sources, "not investment advice" disclaimer. Static → prerendered in D2.

### Feature C2: Newsletter (email capture; n8n Brevo integration is a later task)
**Epic C2.1 — Supabase table** — commit SQL as `quantum-web/doc/sql/newsletter_subscribers.sql`, run in SQL editor
- [ ] `newsletter_subscribers(id, email, source, created_at)`; unique index on `lower(email)`; RLS: anon INSERT-only with email-regex check, no SELECT — n8n later reads with service_role to build the Brevo `to:[]` list (replacing today's 3 hardcoded recipients in the "Stock Bar Daily" trigger)

**Epic C2.2 — `services/newsletter.service.ts`**
- [ ] `subscribe(email) → 'ok'|'duplicate'|'invalid'|'error'`; reuse Supabase client via getter on `SupabaseService`; insert without `.select()` (no SELECT policy); map Postgres 23505 → 'duplicate' (shown as friendly success)

**Epic C2.3 — `components/newsletter-signup/` + `pages/newsletter/`**
- [ ] Email input + claret button, idle/loading/done/duplicate/error states, honeypot; embed in home hero + footer; `/newsletter` page with pitch copy (canonical prerenderable URL for CTAs)

## CAPABILITY D — SEO & SSR (deployment-ready)

### Feature D1: Environment hygiene *(cheap, do alongside Phase 1)*
**Epic D1.1** — [ ] Fill `environment.prod.ts` (real supabaseUrl/anonKey/priceApiUrl — anon key is public by design) + add `fileReplacements` to angular.json production config; verify dist contains the Railway URL

### Feature D2: SSR via @angular/ssr
**Epic D2.1 — Browser-API guards** *(MUST land before ng add)*
- [ ] `dynamic-island-toc`: guard `window.addEventListener` in ngOnInit with `isPlatformBrowser` (guaranteed SSR crash today)
- [ ] `ticker-tape`: render placeholders always, poll only in browser; `reveal.directive` already guarded (verify)

**Epic D2.2 — `ng add @angular/ssr`** *(after all routes exist)*
- [ ] NgModule path: server module + `provideServerRendering`; server routes: `''`/`about`/`newsletter` → Prerender, `stock/:ticker` + `stock/:ticker/:factor` → Server (content changes daily); `provideClientHydration(withEventReplay())`
- [ ] Note API rename `provideServerRoutesConfig`→`provideServerRouting` across 19.0→19.2 — match installed minor. Fallback (budget ~half day): classic CommonEngine + prerender routes file
- [ ] TransferState caching in `SupabaseService` (no client re-fetch flash on hydration)

**Epic D2.3 — SEO service + per-route meta**
- [ ] Create `services/seo.service.ts`: `set({title, description, canonical, og, jsonLd, noindex})` via Title/Meta/DOCUMENT with cleanup on route change
- [ ] Home: "Stock Bar — Free AI Stock Analysis, Updated Daily" + WebSite/Organization JSON-LD; Stock: `"{ticker} Stock Analysis & AI Score — {name}"` (Danelfin pattern), description from `summary.headline`, Article JSON-LD, `noindex` on notFound; Factor: `"{ticker} {Factor} — AI Analysis Chain"` + BreadcrumbList; About/Newsletter static; index.html OG defaults

**Epic D2.4 — robots.txt + sitemap**
- [ ] `public/robots.txt`; Express `GET /sitemap.xml` in `server.ts` from `getStocks()` (all pages incl. 7 factor URLs per ticker, lastmod from `run_at`, ~1h memory cache)

## CAPABILITY E — S&P 500 Logo File *(LOW priority, last)*

**Epic E1.1** — [ ] `public/data/sp500-logos.json` (ticker → ticker-keyed CDN URL, e.g. financialmodelingprep image-stock; Clearbit is dead) + `services/logo.service.ts` resolve chain: `stock.logo_url` → mapping → monogram fallback; consumers: stock-card + infobox

---

## Ordering

1. **Phase 1**: task-checklist file → D1.1 → A1.1 → A1.2 → A2.1 → A2.2 → A3.1
2. **Phase 2**: B1.1 → B1.2 (capture real raw_output sample first) → B1.4 → B1.3 → B2.1 → B2.2 → B2.3
3. **Phase 3**: C2.1 → C2.2 → C2.3 → C1.1 → wire signup into hero/footer
4. **Phase 4**: D2.1 → D2.2 → D2.3 → D2.4
5. **Phase 5**: E1.1 → final doc/ write-up

## Verification

- Each phase: `npm start` → check `/`, `/stock/AAPL`, `/stock/AAPL/political`, `/about`, `/newsletter`; `npm run build` green
- Dead code: `grep -rn "gsap\|embla\|hero-backdrop\|stock-fan" src/` empty; `npm ls gsap` fails
- Newsletter: double-subscribe → duplicate message; row visible in Supabase; anon SELECT rejected
- SSR: `node dist/quantum-web/server/server.mjs` → `curl -s localhost:4000/stock/AAPL | grep -E '<title>|og:|ld\+json|canonical'` shows ticker-specific values AND rendered `summary.headline` text; `/sitemap.xml`, `/robots.txt` respond; `/about` exists as static prerendered HTML; no hydration warnings in console

## Risks

1. SSR + NgModule in ng19 (dev-preview server-routes API) — fallback: CommonEngine + prerender list; contained to Phase 4
2. `raw_output` Q&A shape never captured — defensive parser + raw-text fallback; verify against live row first
3. 8kB per-component style budget — new page CSS goes to shared `styles.css`
4. Ticker-tape hardcoded 12 symbols + Railway dependency — keep/restyle now, derive from `getStocks()` later
5. quantum-web has no dedicated git repo (git root = home dir) — recommend `git init` before Phase 1

## Explicitly out of scope (future tasks, noted for the user)

- n8n changes: persisting L1–L3 rounds, wiring `newsletter_subscribers` into the Brevo "Stock Bar Daily" send, per-stock newsletter deep links
- Writer security cleanup (hardcoded service_role JWT — pre-existing known issue)
- Actual deployment/hosting choice for the Node SSR server
