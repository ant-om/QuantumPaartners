# Task: Data Storage & Data-Type Redesign

Full redesign so the frontend renders structured sections + charts instead of a wall of text.
Plan: `~/.claude/plans/what-i-actually-want-delightful-moler.md`

## Phase 1 — Schema & contract
- [x] Write `schema_v3.sql` (rich `stocks`, JSONB section/summary/metrics columns, RLS, trigger)
- [x] Write `doc/data-model-v3.md` (JSONB contract — single source of truth)
- [x] Move `schema.sql` + `schema_v2.sql` → `ref/deprecated/`
- [x] Apply schema v3 in Supabase (clean-slate `ref/migrations/2026-06-13_clean_v3.sql`) — verified jsonb cols + RLS + 4 seed tickers (2026-06-13)

## Phase 2a — Pipeline (n8n): structurer + summary — APPLIED LIVE (2026-06-13)
- [x] Added `Build Prompt` + `Structure & Summarize` (OpenAI gpt-5-mini, JSON mode) + `Parse AI` to the writer
- [x] Rewrote `Format for Supabase` to emit JSONB sections + summary (metrics null for now)
- [x] Adjusted `Build Payload` + `Check Old Analysis` for JSONB fields (summary, metrics)
- [x] Renamed workflow → "CR Structurer & Supabase Writer"; validated; deactivate/reactivate done
- [x] VALIDATED via isolation test (2026-06-13): TSLA → structured summary (score 55) + macro/price/financial blocks, empties → []
- [ ] (deferred) Replace hardcoded service_role JWT with `httpHeaderAuth` credential
- [ ] (deferred) concurrency = 1

## Phase 2b — Metrics enrichment — APPLIED LIVE (2026-06-13)
- [x] Confirmed Railway quant API live: `GET quantum-price-prompt.up.railway.app/analyze/<ticker>`
- [x] Added `Get Metrics` node to writer (fault-tolerant) → stores response in `metrics`
- [x] Re-mapped frontend `Metrics` type + `metric-charts` to real Railway shape (price 30d + Bollinger + SMA, MC range bar, VIX, rich stat grid) — `ng build` clean
- [x] VALIDATED via execution 4742 (2026-06-13): Get Metrics returned full Railway payload; Format output metrics+summary+blocks. (DB query timing: webhook is async ~25s, query after it settles.)
- [x] Company metadata `/profile` DEPLOYED (2026-06-20): added to live quantum-price-prompt (PythonParserBogdan, commit 0868413, pushed → Railway auto-redeploy ~60s). Verified: TSLA → NasdaqGS / Consumer Cyclical / Auto Manufacturers / US / clearbit logo. Same URL as metrics.
- [ ] Add Get Profile node to writer + update Upsert Stock body (pending n8n MCP reconnect) — see `doc/metadata-profile-deploy.md` step 2

## Phase 3 — Enrichment (Flask + n8n)
- [x] Flask: add `/profile` (yfinance metadata)
- [x] Flask: extend `/analyze` with `price_history`, MA `series`, Monte Carlo `band_series`
- [ ] n8n: enrichment calls `/profile` → full `Upsert Stock`; `/analyze` → `metrics`
- [ ] Deploy/run Flask service

## Phase 4 — Frontend (Angular quantum-web)
- [x] Update `supabase.service.ts` types (`SectionBlock[]`, `Summary`, `Metrics`)
- [x] ~~Add `ngx-echarts`~~ → dependency-free inline SVG charts (Angular-19 peer conflict)
- [x] New components: `analysis-section`, `sentiment-chip`, `score-gauge`, `metric-charts`
- [x] Rebuild `stock-detail` (cards + charts; drop `get()` blob collapse) — builds clean

## Phase 5 — Docs
- [x] `doc/data-model-v3.md`
- [x] `doc/frontend-charts.md`
- [x] `doc/pipeline-structurer.md` (design spec for Phase 2)

## Verify
- [ ] schema applied, REST GET works with anon key
- [ ] Flask `/profile` + `/analyze` return expected JSON
- [ ] CR-L3 run → writer emits JSONB arrays (inspect execution)
- [ ] REST GET stock_analyses shows structured JSONB + stocks metadata
- [ ] `/stock/TSLA` renders cards + charts, no wall of text
