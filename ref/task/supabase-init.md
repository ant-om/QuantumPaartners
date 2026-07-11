# Task: Supabase Initialization

Set up the Supabase database for QuantumPartners with a clean normalized schema, RLS policies, and mock data for development.

## Checklist

- [x] Review old single-table schema
- [x] Design normalized schema v2 (stocks, stock_analyses, stock_analyses_history)
- [x] Write `schema_v2.sql` with tables, indexes, and updated_at trigger
- [x] Write RLS policies for public read access on stocks and stock_analyses
- [x] Generate mock data SQL for 2 stocks (AAPL, MSFT) with full analyses
- [x] User applied schema and mock data in Supabase SQL Editor
- [x] Write documentation to `ref/init/doc/supabase-init.md`
