-- QuantumPartners Database Schema
-- Created: 2026-03-02

-- Master list of stocks
CREATE TABLE stocks (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker  VARCHAR(10) NOT NULL UNIQUE,
  name    VARCHAR(100)
);

-- Current/latest AI analysis per stock
CREATE TABLE stock_analyses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id    UUID NOT NULL REFERENCES stocks(id),
  source      VARCHAR(50),
  run_at      TIMESTAMPTZ DEFAULT NOW(),

  political   TEXT,
  price       TEXT,
  macro       TEXT,
  management  TEXT,
  sentiment   TEXT,
  competitor  TEXT,
  financial   TEXT,
  summary     TEXT,
  raw_output  TEXT
);

CREATE INDEX idx_stock_id ON stock_analyses(stock_id);
CREATE INDEX idx_run_at   ON stock_analyses(run_at DESC);

-- Archive of replaced analyses (audit trail)
CREATE TABLE stock_analyses_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id     UUID NOT NULL,              -- the id it had in stock_analyses
  stock_id        UUID NOT NULL REFERENCES stocks(id),
  source          VARCHAR(50),
  run_at          TIMESTAMPTZ,                -- when it was originally created
  archived_at     TIMESTAMPTZ DEFAULT NOW(),  -- when it got replaced

  political       TEXT,
  price           TEXT,
  macro           TEXT,
  management      TEXT,
  sentiment       TEXT,
  competitor      TEXT,
  financial       TEXT,
  summary         TEXT,
  raw_output      TEXT
);

CREATE INDEX idx_history_stock_id    ON stock_analyses_history(stock_id);
CREATE INDEX idx_history_original_id ON stock_analyses_history(original_id);
CREATE INDEX idx_history_archived_at ON stock_analyses_history(archived_at DESC);
