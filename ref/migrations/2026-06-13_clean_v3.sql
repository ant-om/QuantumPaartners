-- ===========================================================================
-- Clean-slate apply of schema v3  (run in the Supabase SQL editor)
-- Date: 2026-06-13
-- Drops ALL existing QuantumPartners tables and rebuilds from scratch.
-- Use this when you don't need to keep existing data. Self-contained, one paste.
-- Mirrors schema_v3.sql (canonical) + re-seeds the known tickers.
-- ===========================================================================

BEGIN;

-- 1. Drop everything ----------------------------------------------------------
DROP TABLE IF EXISTS stock_analyses_history CASCADE;
DROP TABLE IF EXISTS stock_analyses         CASCADE;
DROP TABLE IF EXISTS stocks                 CASCADE;

-- 2. stocks -------------------------------------------------------------------
CREATE TABLE stocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker      VARCHAR(10)  NOT NULL UNIQUE,
  name        VARCHAR(200) NOT NULL,
  exchange    VARCHAR(20),
  sector      VARCHAR(100),
  industry    VARCHAR(100),
  country     VARCHAR(50),
  description TEXT,
  website     VARCHAR(300),
  logo_url    VARCHAR(500),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. stock_analyses (JSONB sections) -----------------------------------------
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

-- 4. stock_analyses_history ---------------------------------------------------
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

-- 5. updated_at trigger -------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stocks_updated_at
  BEFORE UPDATE ON stocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 6. RLS: public anon read on stocks + analyses ------------------------------
ALTER TABLE stocks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_analyses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_analyses_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read stocks"
  ON stocks FOR SELECT USING (true);
CREATE POLICY "public read stock_analyses"
  ON stock_analyses FOR SELECT USING (true);

COMMIT;

-- 7. Seed known tickers -------------------------------------------------------
INSERT INTO stocks (ticker, name) VALUES
  ('AAPL', 'Apple Inc.'),
  ('MSFT', 'Microsoft Corporation'),
  ('PLTR', 'Palantir Technologies'),
  ('TSLA', 'Tesla, Inc.')
ON CONFLICT (ticker) DO NOTHING;
