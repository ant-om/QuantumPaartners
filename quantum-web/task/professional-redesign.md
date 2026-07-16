# Professional Redesign — FT-style theme, Danelfin-style stock pages, About/Newsletter, SSR/SEO

Full plan: capabilities → features → epics. Mark items `[x]` as they complete.
User decisions: light FT theme · factor chain = round-4 Q&A from `raw_output` (no n8n changes) · logos low priority · full SSR/prerender · factor scores read DIRECTLY from analysis blocks (no client-side averaging) · newsletter wording "Get free Stock Bar newsletter" · graphics diversified across modules (price-specific ones live on the Price factor page).

## Phase 1 — CAPABILITY A: Editorial FT-Style Theme (+ D1 env hygiene)

### Epic D1.1 — Environment hygiene
- [x] Fill `environment.prod.ts` (real supabaseUrl/anonKey/priceApiUrl) + add `fileReplacements` to angular.json production config

### Epic A1.1 — Token system + font swap (`src/styles.css`, `src/index.html`)
- [x] Rewrite `:root`: `--bg:#FBF2E7`, `--bg-wash:#F4E8D9`, `--card:#FFF`, `--text:#33302E`, accents claret `#990F3D` / oxford `#0F5499` / teal `#0D7680`, `--bull:#147B58`, `--bear:#A81E1E`; delete `--accent-grad`, `--glow`; radii 2/4/6px; faint shadows
- [x] Fonts: Source Serif 4 (display) + Inter Tight (body) + JetBrains Mono (numbers); update Google Fonts link; theme-color `#FBF2E7`
- [x] Remove dark machinery: grain overlay, `.qp-glass`→`.qp-panel`, gradient text→solid claret; rework `.qp-btn`/`.qp-eyebrow`/`.qp-badge`/`.qp-infobox`/`.qp-section-heading`

### Epic A1.2 — Component restyle sweep
- [x] nav, ticker-tape, sentiment-chip, score-gauge, analysis-section, dynamic-island-toc, metric-charts, home/stock-detail/app css
- [x] `grep -rn "34d399\|22d3ee\|07090d" src/` → empty

### Epic A2.1 — Delete decorative machinery & dead code
- [x] Delete `stock-fan/`, `stock-carousel/`, `hero-backdrop/`; clean module + home template
- [x] `npm uninstall gsap embla-carousel`; build green

### Epic A2.2 — Professional stock-card grid
- [x] Create `components/stock-card/` (white, 1px border, claret top bar, monogram fallback, real `<a routerLink>`)
- [x] Home grid `repeat(auto-fill,minmax(240px,1fr))`

### Epic A3.1 — Homepage editorial layout
- [x] Hero (serif headline, search, stats, newsletter slot), coverage grid, how-it-works (real L1→L5), methodology strip, footer with /about /newsletter

## Phase 2 — CAPABILITY B: Stock Page Restructure

### Epic B1.1 — Factor registry + routes
- [x] `src/app/models/factors.ts` (key/module/label/slug ×7; fs→financial, competition→competitor)
- [x] Route `stock/:ticker/:factor` with slug validation

### Epic B1.2 — Lazy raw_output fetch + parser
- [x] Capture one live row's `raw_output` shape (anon query) first
- [x] `getFactorChain(stockId, moduleKey)` — JSON-path select, whitelist only
- [x] `parseFactorChain()` with raw-text fallback

### Epic B1.3 — Factor detail page
- [x] `pages/factor-detail/`: breadcrumb, per-block score bars header, SectionBlocks, round-4 Q&A chain (Q1–Q5 + conclusion), prev/next factor

### Epic B1.4 — Stock page layout (Danelfin-style)
- [x] Score anchor (gauge + headline + narrative), 7 factor cards (DIRECT scores from blocks — conclusion block else block bars, no averaging), condensed takeaways below
- [x] Update dynamic-island-toc anchors

### Epic B2.1 — Restyle existing charts to FT palette
- [x] price/VIX/Monte-Carlo/gauge token colors, serif titles, fix `#6366f1` inconsistency

### Epic B2.2 — Split charts by placement
- [x] Stock page: price + VIX; Price factor page: Monte Carlo + technical regime strip (RSI/MACD/cross/GARCH) + VaR/drawdown stat grid; Financial factor page: beta/FF-alpha

### Epic B2.3 — analysis-charts component
- [x] Factor-score bars + sentiment mix (from SectionBlocks), per-block score bars component

### Epic B2.4 — Score evolution timeline
- [x] SQL view `analysis_score_history` over history (run_at + scores only, anon read) → `doc/sql/`
- [x] `getScoreHistory()` + line chart (hidden until ≥2 runs)

## Phase 3 — CAPABILITY C: New Pages

### Epic C2.1 — newsletter_subscribers table
- [x] SQL: table + unique lower(email) + RLS anon INSERT-only → `doc/sql/newsletter_subscribers.sql`, run in Supabase

### Epic C2.2 — newsletter.service.ts
- [x] `subscribe()` → ok/duplicate/invalid/error; no `.select()` after insert; 23505→duplicate

### Epic C2.3 — Signup component + /newsletter page
- [x] "Get free Stock Bar newsletter" form (states + honeypot); embed hero + footer; `/newsletter` page

### Epic C1.1 — About page
- [x] `/about`: mission (free verified AI analysis), daily updates, honest L1→L5 methodology, disclaimer

## Phase 4 — CAPABILITY D: SSR & SEO

### Epic D2.1 — Browser-API guards (before ng add)
- [x] dynamic-island-toc `isPlatformBrowser` guard; ticker-tape polls browser-only

### Epic D2.2 — @angular/ssr
- [x] ng add (NgModule path); prerender ''/about/newsletter, SSR stock routes; hydration + TransferState

### Epic D2.3 — SEO service + per-route meta
- [x] `seo.service.ts`; titles/descriptions/canonical/OG/JSON-LD per route; index.html defaults

### Epic D2.4 — robots + sitemap
- [x] `public/robots.txt`; `/sitemap.xml` Express handler from getStocks() incl. factor URLs

## Phase 5 — CAPABILITY E: Logos (low priority)

### Epic E1.1 — S&P 500 logo mapping
- [x] `public/data/sp500-logos.json` (ticker-keyed CDN) + `logo.service.ts` fallback chain

## Wrap-up
- [x] `doc/professional-redesign.md` write-up
- [x] Note future n8n follow-ups: structurer emits per-factor {score,sentiment}; Brevo reads newsletter_subscribers; persist L1–L3 rounds
