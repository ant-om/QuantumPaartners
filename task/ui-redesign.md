# Task: Full UI redesign — Premium SaaS (dark) design system

Direction: Premium SaaS dark (Linear/Vercel). Full design system. One bold hero moment.
Keep the fan carousel as the centerpiece. Apply landing-page-pro + typography-master principles.

## Design system
- Type: **Sora** (display) + **Inter Tight** (body) + **JetBrains Mono** (numbers/tickers). Dropped default Inter.
- Color: near-black canvas (#07090d), glass surfaces, text ramp; ONE accent gradient (emerald→cyan). Green=bullish / red=bearish kept for sentiment.
- Tokens: fluid `clamp()` type scale, spacing, radii, shadows, grain. `:root` vars in styles.css.
- Anti-slop: extreme weight contrast, whitespace, tabular-nums for data, text-wrap balance/pretty.

## Checklist
- [x] Tokens + fonts + global dark base in `styles.css` (canvas, grain, scrollbar, selection, helpers)
- [x] `appReveal` directive (IntersectionObserver scroll-reveal) + registered in module
- [x] `app-nav` sticky header (blur on scroll, live pulse) in app shell, shown on all pages
- [x] `app-hero-backdrop` animated bg (canvas particle constellation + aurora + grid; reduced-motion + tab-hidden aware)
- [x] Home hero restyle: Sora headline w/ one gradient word, glass pill search, stats line, scroll cue
- [x] Restyle fan cards for dark glass (logo on white chip so brand logos read; mono ticker)
- [x] Home assembly: section heads, "How it works" 3-card grid, footer; scroll reveals throughout
- [x] Stock-detail: summary card (accent bar + glass), dark sections, 65ch measure, reveals
- [x] Restyle shared components via tokens: sentiment-chip, score-gauge, metric-charts (+SVG colors), analysis-section, dynamic-island-toc
- [x] Bumped bundle budget (gsap + design system) → build warning-free
- [x] Verify `ng build` clean + live :4200 serves new design (fonts + tokens + components confirmed)
- [x] Doc in `doc/ui-redesign.md`

## Note
Visual/animation polish (exact card sizes, hero density) best judged by eye at http://localhost:4200.
No browser-automation driver installed, so I verified via build + served-bundle grep, not screenshot.
