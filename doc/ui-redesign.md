# UI redesign — Premium SaaS (dark) design system

**Date:** 2026-06-21
**Status:** Built & integrated; `ng build` clean (warning-free after budget bump); served live on :4200.
Visual polish best judged by eye (no browser driver to screenshot from here).

## Goal & direction
The site looked generic ("raw", AI-default). Chosen direction (with the user): **Premium SaaS dark**
(Linear/Vercel feel), a **full design system**, and **one bold hero moment** — keeping the GSAP fan
carousel as the centerpiece. Applied the `landing-page-pro` design philosophy + `typography-master`
type system (both skills are React/zip-packed on disk; used their *principles*, implemented in Angular).

## Type system
Loaded via Google Fonts in `index.html` (preconnect + display=swap):
- **Sora** — display (hero, headings, card titles)
- **Inter Tight** — body
- **JetBrains Mono** — every number, ticker, label, eyebrow (tabular-nums) → the "terminal" feel

## Tokens (`src/styles.css` `:root`)
Single source of truth everything inherits from:
- Canvas/surfaces: `--bg #07090d`, `--bg-elev`, `--surface/-2/-hover`, `--border/-strong`
- Text ramp: `--text / --text-2 / --text-muted`
- Accent: `--accent #34d399`, `--accent-2 #22d3ee`, `--accent-grad` (emerald→cyan), `--accent-soft`
- Markets: `--bull #34d399`, `--bear #f87171`, `--warn #fbbf24`
- Radii, shadows, `--glow`; fluid type scale `--step--1 … --step-6` via `clamp()`
- Global: grain overlay (`body::before` SVG noise), custom scrollbar, accent selection,
  `.reveal` scroll-in (with `prefers-reduced-motion` off-switch), helpers (`.qp-mono`,
  `.qp-accent-text`, `.qp-glass`, `.qp-eyebrow`).

## New pieces
- **`app-nav`** (`components/nav`) — fixed header, transparent → blur/border on scroll, brand + live
  "AI EQUITY INTELLIGENCE" pulse. Rendered once in `app.component.html` so it's on every route.
- **`app-hero-backdrop`** (`components/hero-backdrop`) — the hero moment. Canvas **particle
  constellation** (nodes + proximity lines) + two drifting **aurora** blobs + faint masked **grid**
  + vignette. Runs `requestAnimationFrame` **outside Angular** (NgZone), pauses on tab-hidden,
  honours `prefers-reduced-motion` (draws one static frame), DPR-capped, particle count scales to area.
- **`appReveal`** directive (`directives/reveal.directive.ts`) — IntersectionObserver fade-up,
  optional `[revealDelay]`; adds `.reveal`/`.is-in`. Used across home + detail. SSR/no-IO safe.

## Pages
- **Home** (`pages/home`): hero (eyebrow → Sora headline with one gradient word "AI" → sub →
  glass pill search → mono stats → scroll cue), the **fan carousel** centerpiece (search-filtered),
  a **"How it works"** 3-step glass-card grid, and a footer. Reveals stagger the sections.
  Removed the old `bgItems` scattered-ticker array (the canvas backdrop replaces it).
- **Stock detail** (`pages/stock-detail`): inherits dark tokens from the global rewrite; **summary
  card** rebuilt (left accent bar, glass, gradient wash, balanced headline, 65ch narrative); analysis
  sections + charts wrapped in reveals; infobox/badges/intro now dark-token based.

## Shared components flipped to dark
All previously had hardcoded light hex — now token-driven:
- `sentiment-chip` — translucent semantic chips (emerald/slate/red) + glow dot, mono caps
- `score-gauge` — track `rgba(255,255,255,.1)`, accent value colors, mono numerals
- `analysis-section` — glass cards, Sora titles, accent bullet markers, hover lift
- `metric-charts` — **TS/HTML SVG colors** updated (grid lines, axis text → mono/muted, price line
  & Monte-Carlo mean → accent cyan/emerald, "last" marker → light; VIX kept purple — reads on dark);
  CSS → glass stat tiles with mono tabular values
- `dynamic-island-toc` — dark glass pill, accent progress ring + dots, token text

## Fan carousel (kept, restyled)
Dark glass card body with a **white logo chip** (brand logos are usually dark, so they need a light
plate to read on a dark card) + mono ticker caption; monogram fallback now accent-on-dark; arrows/dots
re-themed to accent. Logic unchanged.

## Build / ops notes
- Bumped `angular.json` initial budget 500kB→850kB (warn) / 1MB→1.5MB (error). The app legitimately
  grew with gsap + the design system; build is now warning-free (~735kB initial / ~189kB transfer).
- Fonts are render-blocking-safe via `display=swap`; grain is a tiny inline SVG (no asset request).

## Verify
`ng serve` → `http://localhost:4200`:
- Home: animated constellation hero, gradient "AI" headline, glass search, fan of logo cards,
  how-it-works cards revealing on scroll, sticky nav blurring on scroll, footer.
- Click a card → dark stock-detail: glass summary with score gauge, dark analysis cards, dark charts,
  floating glass TOC.
- Narrow the window / set reduced-motion → backdrop calms, reveals disabled, layout holds.
`ng build` passes TS strict + template type-check, warning-free.
