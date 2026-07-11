# Data Model v3 — JSONB Contract

**Date:** 2026-06-13
**Schema:** `schema_v3.sql` (canonical; v1/v2 moved to `ref/deprecated/`)

This is the single source of truth for the shape of every JSONB field written by
the n8n pipeline and consumed by the Angular frontend. **n8n must produce exactly
this shape; the frontend types (`supabase.service.ts`) must match it.**

---

## Why v3 exists

The CR-L3 pipeline produces a `refined` object where each module
(`macro, political, fs, competition, management, sentiment, price`) is a **map of
question → answer**. v1/v2 flattened each map into a single TEXT blob
(`Object.values(map).join('\n\n')`), and the frontend collapsed newlines on top of
that — producing an unreadable wall of text. v3 stores the analysis **structured**
so the UI can render headings, takeaways, bullets, sentiment chips, scores, and
charts.

---

## Tables

| Table | Purpose | Cardinality |
|---|---|---|
| `stocks` | Company metadata (enriched from yfinance) | 1 per ticker |
| `stock_analyses` | Latest AI analysis, replaced each run | 1 per stock |
| `stock_analyses_history` | Audit trail of replaced analyses | N per stock |

---

## JSONB shapes

### Section block
The unit of every analysis section. Each section column is an **array** of these.

```jsonc
{
  "heading":   "EU regulatory exposure",   // required, short title
  "takeaway":  "One-line bold summary",     // required, shown bold above body
  "body":      "Full prose paragraph.",     // required
  "bullets":   ["point", "point"],          // optional, [] if none
  "sentiment": "negative",                  // "positive" | "neutral" | "negative"
  "score":     35                           // optional int 0-100 (drives a gauge)
}
```

### Section columns
`political, price, macro, management, sentiment, competitor, financial`
— each is `SectionBlock[]` (an array; `[]` when the module produced nothing).

> Module → column name mapping (n8n `refined` key → DB column):
> `macro→macro`, `political→political`, `fs→financial`, `competition→competitor`,
> `management→management`, `sentiment→sentiment`, `price→price`.

### `summary`
```jsonc
{
  "headline":          "Tesla: margins compress as competition bites",
  "narrative":         "2-3 sentence executive overview.",
  "bullets":           ["key point", "key point"],
  "overall_sentiment": "neutral",   // positive | neutral | negative
  "score":             58           // overall 0-100
}
```

### `metrics` (from the Flask Analysis API `/analyze`, extended with series)
```jsonc
{
  "current": {
    "last_price": 248.5,
    "daily_volatility": 0.031,
    "annualized_volatility": 0.49,
    "rsi": 56.2
  },
  "monte_carlo": {
    "expected_price": 262.1,
    "ci95": { "lower": 180.4, "upper": 351.7 },
    "potential_return": 5.4,
    "downside_risk": -27.4,
    "upside_potential": 41.5,
    "num_simulations": 10000,
    "forecast_days": 100,
    "band_series": [ { "day": 1, "p2_5": 246, "p50": 249, "p97_5": 252 } ]
  },
  "price_history":  [ { "date": "2024-01-02", "close": 248.4 } ],
  "moving_averages": {
    "sma": { "20": 250.1, "50": 243.0, "200": 220.5 },
    "ema": { "20": 251.3 },
    "series": [ { "date": "2024-01-02", "sma20": 250, "sma50": 243, "sma200": 220 } ]
  },
  "technical": { "rsi_14": 56.2, "interpretation": "Neutral" },
  "garch": { "omega": 0.0, "alpha": 0.08, "beta": 0.90,
             "conditional_volatility": 0.029, "persistence": 0.98 },
  "var": { "var_95": 0.051, "var_99": 0.072 },
  "performance": { "daily_return": 0.004, "avg_daily_return": 0.001,
                   "avg_monthly_return": 0.02, "sharpe_ratio": 0.78 }
}
```

### `raw_output`
The full untouched n8n `refined` object. Audit/debug only; not rendered.

---

## Empty / missing rules
- A section with no data → `[]` (not `null`). Frontend shows "No data available."
- `metrics` may be `null` if the Flask service was unavailable at write time.
- `summary.score` / block `score` may be omitted → frontend hides the gauge.

## Producers & consumers
- **Producer:** `CR Structurer & Supabase Writer` (n8n, `PJkASA0XLIV5TCka`) —
  GPT structurer builds section blocks + summary; enrichment writes `stocks` +
  `metrics`. See `doc/pipeline-structurer.md`.
- **Consumer:** `quantum-web` `SupabaseService` + `stock-detail`. See
  `doc/frontend-charts.md`.
