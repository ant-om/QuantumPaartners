# Task: Gallery4-style Stock Carousel on Home Page

Replace the plain CSS grid of stock cards with a Gallery4-inspired horizontal draggable carousel where each card has a full-bleed sector photo, gradient overlay, and text at the bottom.

## Checklist

- [x] Install `embla-carousel` (vanilla, framework-agnostic)
- [x] Create `src/app/components/stock-carousel/stock-carousel.component.ts` (Embla init, ngOnChanges reInit, scroll state tracking)
- [x] Create `src/app/components/stock-carousel/stock-carousel.component.html` (header + arrows, embla viewport, slide cards, dot indicators)
- [x] Create `src/app/components/stock-carousel/stock-carousel.component.css` (Gallery4-faithful card styles with gradient overlay)
- [x] Declare `StockCarouselComponent` in `app.module.ts`
- [x] Update `home.component.html` — swap grid for `<app-stock-carousel [stocks]="filtered" [title]="...">`
- [x] Update `.qp-home-body` padding in `styles.css` to allow carousel edge-to-edge scroll
- [x] Verify `ng build` compiles clean
- [x] Start dev server, confirm HTTP 200
