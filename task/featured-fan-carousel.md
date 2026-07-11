# Task: Featured fan-style stock card carousel

Port the supplied React `card-fan-carousel` into a native Angular component and add it as a
"Featured" showcase above the existing Embla list on the home page. Logo cards, GSAP animation.

## Checklist
- [x] Install `gsap` in `quantum-web` (3.15.0, `--legacy-peer-deps` due to pre-existing peer conflict)
- [x] Create `src/app/components/stock-fan/stock-fan.component.ts` (port SocialCards logic, GSAP)
- [x] Create `stock-fan.component.html` (logo cards, click → /stock/:ticker, arrows + dots)
- [x] Create `stock-fan.component.css` (.fan-layout height + .fan-card centered portrait tile)
- [x] Declare `StockFanComponent` in `app.module.ts`
- [x] Add `featured` field in `home.component.ts` (logo'd stocks, slice 7 — stable ref, not a getter)
- [x] Render `<app-stock-fan [stocks]="featured">` above `app-stock-carousel` in home.component.html
- [x] Verify: `ng build` passes (TS strict / template type-check) — clean
- [x] Verify: live `ng serve` on :4200 rebuilt with the new component (bundle contains StockFanComponent)
- [~] Visual pass — needs human eye at http://localhost:4200 (no browser driver installed to screenshot)
- [x] Write `doc/featured-fan-carousel.md`
