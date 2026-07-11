# Ticker tape + Stock Bar rebrand

**Date:** 2026-06-21
**Status:** Done & live. Frontend built clean; `/quotes` endpoint deployed to Railway and verified live.

## 1. Rebrand — site = "Stock Bar", company = Quantum Partners
The product/site is **Stock Bar**; **Quantum Partners** is the company behind it.
- Nav header brand → `Stock·Bar` (`components/nav/nav.component.ts`)
- Footer brand → `Stock·Bar`, with note "A **Quantum Partners** product · © 2026" (`pages/home/home.component.html`)
- `<title>` → "Stock Bar — AI equity intelligence by Quantum Partners" (`index.html`)
- (Left internal `app.component.ts` `title='quantum-web'` — not user-visible. Old unused
  `stock-carousel` still says "QuantumGPT AI" but isn't rendered anywhere.)

## 2. Running ticker tape (broker-style)
A live, infinite-marquee price bar fixed at the very top of every page.

### Backend — new `/quotes` endpoint (Railway price service)
`PythonParserBogdan/app.py` (repo `ant-om/QuantumPaartners`, Railway auto-deploys `main`):
- `GET /quotes?tickers=AAPL,MSFT,...` → `{ "quotes": [{ticker, price, change, change_pct}, ...] }`
- Uses yfinance **`fast_info`** (last_price / previous_close) — fast, no heavy history (~1.7s/3 tickers).
- 45s in-process cache (`_QUOTE_CACHE`) so the tape can poll cheaply; `Access-Control-Allow-Origin: *`
  so the browser can call it directly; caps at 30 tickers.
- Deployed via `git push origin main` (commit `515948b`); Railway redeployed in ~30s. Verified live
  for all 12 tape tickers.

### Frontend
- `services/quotes.service.ts` — `getQuotes(tickers)` via native `fetch` (15s abort timeout).
  Returns `[]` on any failure so the tape never errors out. Base URL from `environment.priceApiUrl`
  (`https://quantum-price-prompt.up.railway.app`; added to `environments/environment.ts`).
- `components/ticker-tape/` — `app-ticker-tape`:
  - Curated symbols: AAPL, MSFT, NVDA, TSLA, AMZN, GOOGL, META, AMD, NFLX, JPM, PEP, PLTR.
  - Paints placeholders (`—`) immediately, fetches live quotes on init, **polls every 60s**
    (interval runs outside Angular via NgZone; `zone.run` only to apply updates).
  - Infinite CSS marquee: track holds the list **twice**, `translateX(0 → -50%)` linear loop;
    pauses on hover; edge mask fade; respects `prefers-reduced-motion`. Mono tabular numerals;
    green/▲ up, red/▼ down. Each item links to `/stock/<ticker>`.
- Layout: tape is `position: fixed; top: 0; height: var(--tape-h, 36px); z-index: 110`. Nav offset
  to `top: var(--tape-h)`. `.qp-detail` top padding bumped to clear tape + nav. Mounted in
  `app.component.html` above `<app-nav>`.

## Resilience
If `/quotes` is ever down/cold, the tape keeps showing ticker names with `—` (or last values) —
it never blanks or throws. Once the API responds, prices fill in on the next poll.

## Verify
- API: `curl "https://quantum-price-prompt.up.railway.app/quotes?tickers=AAPL,MSFT,NVDA"` → JSON.
- UI: `http://localhost:4200` — top bar scrolls live prices, pauses on hover, items route to detail;
  header/footer read "Stock·Bar"; footer credits Quantum Partners. `ng build` clean.
