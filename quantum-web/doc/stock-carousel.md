# Stock Carousel (Gallery4 Port)

## What was built

An Angular port of the React `Gallery4` component. The home page stock grid was replaced with a horizontal draggable carousel. Each slide is a stock card with:
- Full-bleed sector-mapped photo (from Unsplash)
- Dark gradient overlay (transparent → 82% black at bottom)
- Company name, ticker/exchange, sector text and "View analysis →" CTA
- Hover: image zooms 1.05×, arrow shifts right 4px
- Click: navigates to `/stock/:ticker`

The carousel header shows the section title and left/right arrow buttons (desktop only). Dot indicators below reflect the current slide.

## Key decisions

- **`embla-carousel` vanilla** (not `embla-carousel-react`) — works in Angular via `EmblaCarousel(elementRef.nativeElement, opts)` initialized in `ngAfterViewInit`. When `stocks` input changes (search filter), `ngOnChanges` calls `embla.reInit()` inside a `setTimeout(0)` to let Angular update the DOM first.
- **Sector → Unsplash image mapping** — stocks have no photos, so each sector maps to a curated Unsplash photo ID. Unknown sectors fall back to a generic financial chart photo.
- **Search preserved** — `home.component.html` passes `[stocks]="filtered"` to the carousel, so the search box in the hero still narrows the visible slides.
- **Edge-to-edge scroll** — `.qp-home-body` padding was changed from `40px` horizontal to `0` so Embla can scroll cards flush to the viewport edge. The carousel header handles its own `40px` horizontal padding.

## Files changed

| File | Change |
|------|--------|
| `src/app/components/stock-carousel/stock-carousel.component.ts` | New — Embla carousel with sector image mapping |
| `src/app/components/stock-carousel/stock-carousel.component.html` | New — template |
| `src/app/components/stock-carousel/stock-carousel.component.css` | New — Gallery4-style card styles |
| `src/app/app.module.ts` | Declared `StockCarouselComponent` |
| `src/app/pages/home/home.component.html` | Replaced stock grid with `<app-stock-carousel>` |
| `src/styles.css` | Changed `.qp-home-body` horizontal padding to 0 |
| `package.json` | Added `embla-carousel` |
