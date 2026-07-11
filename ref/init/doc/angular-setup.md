# Angular Frontend — QuantumPartners

## How to run

```bash
cd quantum-web
ng serve        # dev server → http://localhost:4200
ng build        # production build → dist/quantum-web
```

Before running, fill in Supabase credentials in `src/environments/environment.ts`:
```ts
supabaseUrl: 'https://xxxx.supabase.co',
supabaseAnonKey: 'eyJ...',
```

---

## Project structure

```
quantum-web/src/app/
├── app.module.ts                   # BrowserModule, FormsModule, routing
├── app-routing.module.ts           # / → Home, /stock/:ticker → StockDetail
├── app.component.html              # Just <router-outlet> — no global shell/topbar
├── services/
│   └── supabase.service.ts         # getStocks(), getStockByTicker(), getAnalysis()
└── pages/
    ├── home/                       # Hero + search + stock cards grid
    └── stock-detail/               # Full article page with infobox + TOC
```

---

## Pages

### Home (`/`)
- Dark hero section (`#0d1117`) with `▲ QUANTUM·PARTNERS` brand in large monospace
- Scattered stock tickers (AAPL, NVDA, TSLA, etc.) and data fragments in the background, animated with a slow flicker — conveys AI/data processing
- Wide transparent frosted-glass search input filters the stock grid live (by ticker, name, or sector)
- Stock cards grid below — clicking any card navigates to `/stock/:ticker`

### Stock Detail (`/stock/:ticker`)
- Full-width article layout (max 1280px), no topbar
- Floating infobox (right side, Wikipedia-style) with logo, exchange, sector, country, last updated
- Company description as intro paragraph
- 8 analysis sections flow continuously as one document: Overview, Political & Regulatory, Price Action, Macro, Management, Sentiment, Competitive Landscape, Financial Health
- Sticky TOC sidebar (right) — clicking items smooth-scrolls to sections
- `← All stocks` link uses `routerLink` (no page reload)

---

## Styling approach
- **Tailwind CSS v4** — layout utilities only (grid, flex, positioning)
- **`styles.css`** — all visual styles via `qp-*` classes. No component-level CSS used.
- **Color palette**: `#0d1117` dark bg, `#6366f1` indigo accent, `#34d399` green for brand/financial signals, `#f1f5f9` light text on dark
- **Fonts**: Inter (body), Courier New (brand name + background tickers)

---

## Key decisions
- **No topbar** — brand identity lives inside the hero only; detail page relies on back link + stock title
- **No dropdown on home** — replaced with a text search that filters the cards grid, more discoverable
- **Infobox float** — uses CSS `float: right` inside the article, mirrors Wikipedia layout
- **Newline stripping** — `get()` method in StockDetailComponent strips `\n` from DB text so it renders as a continuous paragraph
- **TOC uses `scrollIntoView`** — avoids `href="#anchor"` which causes page reload in Angular SPA
- **`raw_output` not displayed** — JSONB field is for n8n/pipeline use only, not shown on the page
