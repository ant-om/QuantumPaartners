# Fan-style stock card carousel (main home carousel)

**Date:** 2026-06-20
**Status:** Built & integrated as the **main** home carousel; compiles clean (`ng build` + live
`ng serve` rebuilt OK). Visual/animation pass needs a human eye at `http://localhost:4200`.

## What & why
The home page listed stocks in a flat Embla rail (`app-stock-carousel`) — looked raw. Replaced it
with a showy **fan / hand-of-cards** GSAP carousel as the single main carousel, driven by the
search box. (Initially shipped as a small "Featured" showcase above the rail, then promoted to the
main carousel and the Embla rail removed from the page — see "Evolution" below.)

## Origin of the component
The source was a **React/Next.js** component (`card-fan-carousel.tsx`, `"use client"`, React
hooks, shadcn `/components/ui` convention). This frontend is **Angular 19.2** — React can't be
copy-pasted and shadcn/`/components/ui` doesn't apply. So the GSAP fan-layout algorithm + Tailwind
classes were **re-implemented as a native Angular component**. GSAP itself is framework-agnostic.

## Files
- NEW `src/app/components/stock-fan/stock-fan.component.{ts,html,css}` — `app-stock-fan`.
- `app.module.ts` — declared `StockFanComponent` (old `StockCarouselComponent` still declared but
  no longer used in any template — safe to remove later to drop `embla-carousel` from the bundle).
- `pages/home/home.component.ts` — `filtered: Stock[]` is now a **field** recomputed in
  `onSearch()` (was a getter). A getter returns a new array each change-detection cycle, which
  would make the fan replay its entry animation constantly — the field keeps a stable reference.
- `pages/home/home.component.html` — search input calls `(ngModelChange)="onSearch()"`; body
  renders `<app-stock-fan [stocks]="filtered">` as the only carousel, under a `.qp-featured-title`
  heading ("All Stocks" / "Results for …"). The `app-stock-carousel` element was removed.
- Dependency: `gsap@3.15.0` (installed with `--legacy-peer-deps`, see note below).

## Evolution (why the filename says "featured")
First cut: fan as a small "Featured" showcase fed by `featured = stocks.filter(s => s.logo_url)
.slice(0,7)`, above the Embla rail. Problem: only **PEP** had a `logo_url` (only PEP had been run
through the `/profile` metadata pipeline), so the logo-only filter collapsed the fan to a single
card. Fix per user: (a) promote the fan to the **main** carousel fed by the full search-filtered
list (monogram fallback covers any logoless stock), and (b) **backfill** metadata for the other
existing tickers (see below). The Embla `app-stock-carousel` was dropped from the home page.

## Key design decisions
- **Logo cards** — each card shows `Stock.logo_url` (clearbit logos from the `/profile` pipeline)
  on a clean branded tile with a ticker + name caption. Missing/failed logos fall back to a
  **ticker monogram** (`onLogoError(i)` → `failed` Set → CSS `.fan-monogram`).
- **Featured subset** — `home.component.ts` sets `featured` once to the first 7 stocks **with a
  logo** (falls back to first 7 overall if none have logos). 7 = a full fan (`MAX_VISIBLE`).
  Set as a **stable field**, NOT a getter — a getter returns a new array each change-detection
  cycle, which would retrigger `ngOnChanges` and replay the entry animation on every CD pass.
- **Placement** — fan above the existing Embla rail; rail + search untouched. Fan is hidden when a
  search query is active so results stay focused.

## Port specifics (React → Angular)
- React refs (`isAnimating`, `hasEntered`, `direction`, `prevVisible`, `centerIndex`) → class
  fields. The big `useEffect` → `runLayout()`, called from `ngAfterViewInit`, after each `cycle()`,
  and from `ngOnChanges(['stocks'])` (which tears down the prior pass's listeners first).
  `ngOnDestroy` runs the stored teardown + `gsap.killTweensOf`.
- `<a href linkUrl>` → `(click)="router.navigate(['/stock', s.ticker])"` (+ keyboard enter, role).
- Pure helpers (`FAN_POSITIONS`, `getResponsiveMultiplier`, `getHeightMultiplier`, `getSlotConfig`,
  `getVisibleMap`) ported verbatim. Chevrons = inline SVG (no lucide-angular).
- `import { gsap } from 'gsap'` (named import is the most robust under TS strict / bundler).

## CSS gotcha (important)
GSAP animates `transform` (x/y/rotation/scale) on `.fan-card`. So cards are centered with
**`position:absolute; top/left:50%` + negative margins** — NOT a CSS `transform`, which GSAP would
overwrite. Card width/height + matching half-size margins scale per breakpoint, in concert with
`getResponsiveMultiplier()` (which scales the x-offsets) and `.fan-layout` height (which matches
`getHeightMultiplier()`'s ideal heights: 22/26/28/34/38rem). If the fan ever clips, tune card
size + `.fan-layout` height together.

## Logo backfill (2026-06-20)
Only PEP had metadata, so the other 4 existing tickers (AAPL, MSFT, PLTR, TSLA) showed monograms.
Backfilled them by fetching `https://quantum-price-prompt.up.railway.app/profile?ticker=<T>` and
upserting the metadata fields into Supabase `stocks` with `?on_conflict=ticker` +
`Prefer: resolution=merge-duplicates` (exactly what the writer's `Upsert Stock` node does — see
`metadata-profile-deploy.md`). All 5 stocks now have real `logo_url`s. To enrich any **new** ticker
later, run the same one-liner or just run it through the n8n writer.

## Notes / follow-ups
- **`--legacy-peer-deps`**: `npm install gsap` failed on a *pre-existing* peer conflict
  (`@angular/animations@19.2.22` wants `@angular/common@19.2.22`, but `19.2.20` is installed —
  the project's own Angular versions are slightly out of sync). gsap has no peer deps; installing
  with `--legacy-peer-deps` is safe. Worth aligning all `@angular/*` to the same patch later.
- **Bundle budget warning**: build now ~747 kB initial vs the 500 kB budget (gsap ≈ +70 kB on an
  already-over-budget app). Warning only, not an error. Bump the budget in `angular.json` if it
  becomes noisy.

## Verify
`ng serve` → `http://localhost:4200`: the fan is the only carousel, shows all 5 logo cards, animates
in (elastic), hover fans cards out, clicking a card opens `/stock/<ticker>`; typing in the search
box re-filters the fan; a logo-less ticker would show its monogram fallback. `ng build` passes TS
strict + template type-check.
