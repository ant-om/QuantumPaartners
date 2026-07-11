-- QuantumPartners Database Schema v3
-- Created: 2026-06-13
-- Canonical schema. Supersedes schema.sql (v1) and schema_v2.sql (v2),
-- both moved to ref/deprecated/.
--
-- Key change vs v2: analysis sections are now structured JSONB (arrays of
-- "section blocks"), plus a structured `summary` and a quantitative `metrics`
-- bundle. This lets the Angular frontend render cards / takeaways / sentiment
-- chips / scores / charts instead of one flattened text blob per section.
-- The JSONB contract is documented in doc/data-model-v3.md.

-- ---------------------------------------------------------------------------
-- stocks — master list + company metadata (populated by the enrichment step)
-- ---------------------------------------------------------------------------
CREATE TABLE stocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker      VARCHAR(10)  NOT NULL UNIQUE,
  name        VARCHAR(200) NOT NULL,
  exchange    VARCHAR(20),        -- e.g. NASDAQ, NYSE, EURONEXT
  sector      VARCHAR(100),       -- e.g. Technology, Healthcare
  industry    VARCHAR(100),       -- e.g. Auto Manufacturers
  country     VARCHAR(50),
  description TEXT,               -- yfinance longBusinessSummary
  website     VARCHAR(300),
  logo_url    VARCHAR(500),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- stock_analyses — latest AI analysis per stock (one row per stock, replaced
-- on each n8n run). Section columns are JSONB arrays of section blocks; see
-- doc/data-model-v3.md for the exact shape.
-- ---------------------------------------------------------------------------
CREATE TABLE stock_analyses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id    UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  source      VARCHAR(50),
  run_at      TIMESTAMPTZ DEFAULT NOW(),

  summary     JSONB,   -- { headline, narrative, bullets[], overall_sentiment, score }
  political   JSONB,   -- [ section block, ... ]
  price       JSONB,
  macro       JSONB,
  management  JSONB,
  sentiment   JSONB,
  competitor  JSONB,
  financial   JSONB,

  metrics     JSONB,   -- quantitative bundle from the Flask Analysis API (charts)
  raw_output  JSONB    -- full untouched n8n `refined` object (audit / debug)
);

CREATE INDEX idx_analyses_stock_id ON stock_analyses(stock_id);
CREATE INDEX idx_analyses_run_at   ON stock_analyses(run_at DESC);

-- ---------------------------------------------------------------------------
-- stock_analyses_history — audit trail of replaced analyses
-- ---------------------------------------------------------------------------
CREATE TABLE stock_analyses_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id   UUID NOT NULL,              -- id it had in stock_analyses
  stock_id      UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  source        VARCHAR(50),
  run_at        TIMESTAMPTZ,                -- when originally created
  archived_at   TIMESTAMPTZ DEFAULT NOW(),  -- when it got replaced

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

-- ---------------------------------------------------------------------------
-- Auto-update stocks.updated_at on row change (carried over from v2)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Row Level Security
--   Public (anon) read on stocks + stock_analyses — the Angular app uses the
--   anon key. History stays private (no anon policy). Writes happen via the
--   service_role key in n8n, which bypasses RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE stocks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_analyses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_analyses_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read stocks"
  ON stocks FOR SELECT USING (true);

CREATE POLICY "public read stock_analyses"
  ON stock_analyses FOR SELECT USING (true);
