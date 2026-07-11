# Supabase Initialization — QuantumPartners

## What was done
Set up the Supabase PostgreSQL database for QuantumPartners from scratch, replacing an old single-table schema with a normalized, production-ready structure.

## Files
- `schema_v2.sql` — creates all tables, indexes, and the `updated_at` trigger
- `supabase_init.sql` — enables RLS, adds public read policies, inserts mock data

## Database Schema

### `stocks`
Master list of all tracked stocks. Fields: `ticker`, `name`, `exchange`, `sector`, `industry`, `country`, `description`, `website`, `logo_url`, `created_at`, `updated_at`.

### `stock_analyses`
Latest AI-generated analysis per stock. One row per stock — replaced on each n8n agent run. Fields: `summary`, `political`, `price`, `macro`, `management`, `sentiment`, `competitor`, `financial`, `raw_output` (JSONB).

### `stock_analyses_history`
Audit trail of replaced analyses. Keeps previous versions when n8n overwrites a stock's analysis.

## Key Decisions

- **No `stock_financials` table** — the site is text/narrative only, no numerical financial data for now.
- **`raw_output` as JSONB** — stores the full n8n agent output for flexibility and future querying, instead of plain TEXT.
- **`ON DELETE CASCADE`** — deleting a stock automatically removes its analyses and history.
- **RLS with public read** — both `stocks` and `stock_analyses` are publicly readable using the Supabase anon key. No auth required since the site is read-only.
- **`stock_analyses_history` not exposed** — no public RLS policy; history is internal only.

## Mock Data
Two stocks inserted for development: `AAPL` (Apple) and `MSFT` (Microsoft), each with a full `stock_analyses` row covering all 8 analysis sections.

## How to Apply to a New Supabase Project
1. Go to Supabase → SQL Editor
2. Run `schema_v2.sql`
3. Run `supabase_init.sql` (RLS + mock data)
4. Go to Project Settings → API and copy the Project URL and anon key for the Angular app
