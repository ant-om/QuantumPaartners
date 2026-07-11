# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QuantumPartners is a Wikipedia-style read-only website for stocks. Data flows from n8n AI agents → Supabase (PostgreSQL) → Angular frontend. There is no custom backend.

## Repository Structure

```
QuantumPartners/
├── schema_v2.sql           # Supabase DB schema (run first)
├── ref/
│   └── init/               # Reference SQL scripts
│       ├── task/
│       └── doc/
├── Analysis/               # Flask microservice — quantitative stock analysis API
│   ├── app.py              # Main API (Monte Carlo, GARCH, VaR, RSI, moving averages)
│   ├── requirements.txt
│   └── Procfile            # gunicorn app:app
└── PythonParserBogdan/     # Variant of the analysis service (includes fear_and_greed index)
    ├── app.py
    └── requirements.txt
```

The Angular frontend does not exist yet — it is the next thing to build.

## Database (Supabase)

Schema is in `schema_v2.sql`. Apply it in the Supabase SQL Editor before anything else.

**Tables:**
- `stocks` — company metadata (ticker, name, exchange, sector, industry, country, description, logo_url, website)
- `stock_analyses` — latest AI analysis per stock, one row per stock, replaced on each n8n run. Fields: `summary`, `political`, `price`, `macro`, `management`, `sentiment`, `competitor`, `financial`, `raw_output` (JSONB)
- `stock_analyses_history` — audit trail of replaced analyses

**RLS:** Public anonymous read is enabled on `stocks` and `stock_analyses`. The Angular app uses the Supabase anon/public key — never the service role key.

## Analysis API (Flask)

Located in `Analysis/`. Runs independently from the frontend.

```bash
cd Analysis
pip install -r requirements.txt
python app.py          # dev server on port 8080
gunicorn app:app       # production
```

**Endpoints:**
- `GET /health` — health check
- `POST /analyze` — body: `{"ticker": "TSLA", "simulations": 10000, "days": 100}`

Returns: Monte Carlo simulation, GARCH(1,1) model, VaR at 95%/99%, RSI, SMA/EMA (20/50/200), Sharpe ratio. Data is fetched live from yfinance starting 2019-01-01.

`PythonParserBogdan/app.py` is a variant that adds the Fear & Greed index but has a stray `git` line on line 11 (syntax error — do not run as-is).

## Angular Frontend (to be built)

**Planned UX:**
- Main page: dropdown to select a stock → navigates to stock detail page
- Stock detail page: company overview at top, then scrollable AI analysis sections (summary → political → price → macro → management → sentiment → competitor → financial)

**Supabase integration:** Use `@supabase/supabase-js`. Store `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `environment.ts` (not hardcoded). The client should be provided as an Angular service.
