-- ===========================================================================
-- Migration: apply schema v3  (run in the Supabase SQL editor)
-- Date: 2026-06-13
-- Strategy: PRESERVE `stocks` (rows + UUIDs + any metadata), REBUILD the
--           analysis tables. Old section columns are flattened TEXT and cannot
--           be converted to structured JSONB, so they are dropped & recreated;
--           that data regenerates on the next pipeline run.
-- Safe to run on either the v1 or v2 schema (ADD COLUMN IF NOT EXISTS is a
-- no-op where columns already exist). Wrapped in a transaction.
-- ===========================================================================

BEGIN;

-- 1. Upgrade `stocks` in place (v1/v2 → v3) — no data loss --------------------
ALTER TABLE stocks ALTER COLUMN name TYPE VARCHAR(200);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS exchange    VARCHAR(20);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS sector      VARCHAR(100);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS industry    VARCHAR(100);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS country     VARCHAR(50);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS website     VARCHAR(300);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS logo_url    VARCHAR(500);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

-- 2. Rebuild analysis tables as JSONB ----------------------------------------
DROP TABLE IF EXISTS stock_analyses_history CASCADE;
DROP TABLE IF EXISTS stock_analyses         CASCADE;

CREATE TABLE stock_analyses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id    UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  source      VARCHAR(50),
  run_at      TIMESTAMPTZ DEFAULT NOW(),
  summary     JSONB,
  political   JSONB,
  price       JSONB,
  macro       JSONB,
  management  JSONB,
  sentiment   JSONB,
  competitor  JSONB,
  financial   JSONB,
  metrics     JSONB,
  raw_output  JSONB
);
CREATE INDEX idx_analyses_stock_id ON stock_analyses(stock_id);
CREATE INDEX idx_analyses_run_at   ON stock_analyses(run_at DESC);

CREATE TABLE stock_analyses_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id   UUID NOT NULL,
  stock_id      UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  source        VARCHAR(50),
  run_at        TIMESTAMPTZ,
  archived_at   TIMESTAMPTZ DEFAULT NOW(),
  summary     JSONB,
  political   JSONB,
  price       JSONB,
  macro       JSONB,
  management  JSONB,
  sentiment   JSONB,
  competitor  JSONB,
  financial   JSONB,
  metrics     JSONB,
  raw_output  JSONB
);
CREATE INDEX idx_history_stock_id    ON stock_analyses_history(stock_id);
CREATE INDEX idx_history_original_id ON stock_analyses_history(original_id);
CREATE INDEX idx_history_archived_at ON stock_analyses_history(archived_at DESC);

-- 3. updated_at trigger (idempotent) -----------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stocks_updated_at ON stocks;
CREATE TRIGGER stocks_updated_at
  BEFORE UPDATE ON stocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. Row Level Security (public anon read on stocks + analyses) --------------
ALTER TABLE stocks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_analyses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_analyses_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read stocks"         ON stocks;
DROP POLICY IF EXISTS "public read stock_analyses" ON stock_analyses;

CREATE POLICY "public read stocks"
  ON stocks FOR SELECT USING (true);
CREATE POLICY "public read stock_analyses"
  ON stock_analyses FOR SELECT USING (true);

COMMIT;

-- 5. Seed the known tickers (so the writer's Get Stock ID + frontend work
--    before the enrichment step lands real metadata). Safe to re-run.
INSERT INTO stocks (ticker, name) VALUES
  ('AAPL', 'Apple Inc.'),
  ('MSFT', 'Microsoft Corporation'),
  ('PLTR', 'Palantir Technologies'),
  ('TSLA', 'Tesla, Inc.')
ON CONFLICT (ticker) DO NOTHING;
