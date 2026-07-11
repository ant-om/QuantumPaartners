-- QuantumPartners Database Schema v2
-- Created: 2026-03-27

-- Master list of stocks with company metadata
CREATE TABLE stocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker      VARCHAR(10)  NOT NULL UNIQUE,
  name        VARCHAR(200) NOT NULL,
  exchange    VARCHAR(20),        -- e.g. NYSE, NASDAQ, EURONEXT
  sector      VARCHAR(100),       -- e.g. Technology, Healthcare
  industry    VARCHAR(100),       -- e.g. Semiconductors, Biotechnology
  country     VARCHAR(50),
  description TEXT,               -- short company bio (can be AI-generated)
  website     VARCHAR(300),
  logo_url    VARCHAR(500),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Current/latest AI analysis per stock (one row per stock, replaced on each n8n run)
CREATE TABLE stock_analyses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id    UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  source      VARCHAR(50),
  run_at      TIMESTAMPTZ DEFAULT NOW(),

  summary     TEXT,       -- overall AI-generated overview
  political   TEXT,       -- geopolitical & regulatory context
  price       TEXT,       -- price action & technicals
  macro       TEXT,       -- macroeconomic environment
  management  TEXT,       -- leadership & governance
  sentiment   TEXT,       -- market/social sentiment
  competitor  TEXT,       -- competitive landscape
  financial   TEXT,       -- financial health narrative

  raw_output  JSONB       -- full n8n agent output for flexibility
);

CREATE INDEX idx_analyses_stock_id ON stock_analyses(stock_id);
CREATE INDEX idx_analyses_run_at   ON stock_analyses(run_at DESC);

-- Archive of replaced analyses (audit trail)
CREATE TABLE stock_analyses_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id   UUID NOT NULL,
  stock_id      UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  source        VARCHAR(50),
  run_at        TIMESTAMPTZ,
  archived_at   TIMESTAMPTZ DEFAULT NOW(),

  summary     TEXT,
  political   TEXT,
  price       TEXT,
  macro       TEXT,
  management  TEXT,
  sentiment   TEXT,
  competitor  TEXT,
  financial   TEXT,

  raw_output  JSONB
);

CREATE INDEX idx_history_stock_id    ON stock_analyses_history(stock_id);
CREATE INDEX idx_history_original_id ON stock_analyses_history(original_id);
CREATE INDEX idx_history_archived_at ON stock_analyses_history(archived_at DESC);

-- Auto-update updated_at on stocks row change
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
