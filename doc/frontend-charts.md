# Frontend — Structured Sections & Charts

**Date:** 2026-06-13
**App:** `quantum-web` (Angular 19, NgModule-based)

## What changed

The stock detail page no longer renders one flattened text blob per section. It
now consumes the v3 JSONB contract (`doc/data-model-v3.md`) and renders:

- **Overview card** — `summary` JSONB (headline, narrative, bullets, overall
  sentiment chip, score gauge).
- **Section cards** — each analysis section (`political`, `price`, …) is a
  `SectionBlock[]`; each block renders as a card with heading, bold takeaway,
  body, bullet list, a sentiment chip, and a score gauge.
- **Charts** — injected into the Price Action section from the `metrics` bundle.

## Components (all declared in `app.module.ts`)

| Component | Selector | Role |
|---|---|---|
| `SentimentChipComponent` | `app-sentiment-chip` | colored positive/neutral/negative pill |
| `ScoreGaugeComponent` | `app-score-gauge` | SVG arc gauge for a 0-100 score |
| `AnalysisSectionComponent` | `app-analysis-section` | renders a `SectionBlock[]` as cards |
| `MetricChartsComponent` | `app-metric-charts` | quant stat grid + SVG charts |

## Charts: why inline SVG (not ngx-echarts)

The plan called for `ngx-echarts`, but `npm install` hit an Angular-19
peer-dependency conflict (`ngx-echarts` would need `--legacy-peer-deps`/`--force`).
To avoid forcing a fragile dependency into `package.json`, charts are
**dependency-free inline SVG** in `MetricChartsComponent`:

- **Price & moving averages** — multi-line chart (close + SMA 20/50/200), shared
  auto-scaled Y axis, legend.
- **Monte Carlo forecast** — 95% confidence band (filled `<path>` polygon between
  `p2_5` and `p97_5`) + median polyline, from `metrics.monte_carlo.band_series`.
- **Quant stat grid** — last price, annualized volatility, expected price,
  potential return, RSI + interpretation, Sharpe, VaR 95/99, GARCH persistence.

Scaling/path math lives in `metric-charts.component.ts` (`buildPrice`,
`buildMonteCarlo`, `buildVix`, `buildStats`), recomputed in `ngOnChanges`. Swapping to
ECharts later is isolated to this one component.

### Metrics source (as-built, 2026-06-13)
`metrics` is populated by the n8n writer's `Get Metrics` node calling the **live
Railway quant API** `GET https://quantum-price-prompt.up.railway.app/analyze/<ticker>`
and stored as-is. That deployed service is richer than the local `Analysis/app.py`
(it adds `factor_model`, `drawdown`, `technicals` MACD/Bollinger/golden-death-cross,
`vix_*`). The `Metrics` interface in `supabase.service.ts` and the charts mirror
**that** shape:
- **Price (30d)** line from `price.last_30d_close`, with `technicals.bollinger_bands`
  as a shaded band and `SMA_50_last`/`SMA_200_last` as dashed reference lines.
- **Monte Carlo** horizontal range bar from `monte_carlo.ci_95_lower/upper/mean_price`
  vs `price.last_close` (short horizon, so a range bar not a fan).
- **VIX (30d)** line from `vix_levels.vix_last_30d`.
- **Stat grid**: last close, ann. vol, Sharpe, RSI+state, VaR 95/99, max drawdown,
  CAPM beta, FF alpha, MACD, golden/death cross, GARCH persistence, VIX.

Note: the local `Analysis/app.py` (with `/profile` + custom series) is NOT what's
deployed; company metadata still has no source (Railway is price-only).

## Data access

`SupabaseService.getAnalysis()` selects the structured columns
(`summary, political, price, …, metrics`) and returns typed `StockAnalysis`.
`stock-detail.component.ts` exposes `blocks(key)` for section arrays; the old
newline-collapsing `get()` is gone.

## Empty handling
- Missing section → `[]` → "No data available."
- Missing `metrics` → charts block hidden (`*ngIf="analysis?.metrics"`).
- Missing `score`/`sentiment` on a block → gauge/chip hidden.

## Verify
`npx ng build` compiles clean. Once schema v3 + a real analysis row exist, open
`/stock/TSLA` and confirm cards + charts render with no wall of text.
