-- Supabase / PostgreSQL schema for Market Daily News
-- Run this in SQL editor (Supabase SQL editor or psql) to create the required tables.

-- Table to track stock symbols being monitored
CREATE TABLE IF NOT EXISTS tracked_stocks (
  symbol text PRIMARY KEY,
  name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table to store news items
CREATE TABLE IF NOT EXISTS stock_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_symbol text NOT NULL,
  title text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  source text,
  url text,
  summary text,
  published_at timestamptz,
  is_sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_stock_symbol
    FOREIGN KEY (stock_symbol)
    REFERENCES tracked_stocks(symbol)
    ON DELETE SET NULL
);

-- Indexes to help query

CREATE INDEX IF NOT EXISTS idx_stocknews_published_at
  ON stock_news (published_at DESC);

-- Note: gen_random_uuid() requires the pgcrypto extension; enable it if missing
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;
