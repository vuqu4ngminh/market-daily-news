-- Run once in the Supabase SQL Editor before deploying the application code.
-- Safe to run repeatedly.

BEGIN;

CREATE TABLE IF NOT EXISTS international_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  translated_title text,
  dedupe_key text NOT NULL UNIQUE,
  source text NOT NULL,
  url text,
  summary text,
  original_language text NOT NULL DEFAULT 'en',
  is_economic boolean,
  ai_processed boolean NOT NULL DEFAULT false,
  ai_model text,
  ai_confidence numeric(4,3)
    CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  ai_error text,
  published_at timestamptz,
  is_sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_international_news_published_at
  ON international_news (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_international_news_unsent
  ON international_news (is_sent, published_at DESC);

-- Move any Yahoo Finance rows previously stored in stock_news. The insert and
-- delete run in one transaction, so a failure rolls the whole migration back.
INSERT INTO international_news (
  id,
  title,
  dedupe_key,
  source,
  url,
  summary,
  original_language,
  published_at,
  is_sent,
  sent_at,
  created_at
)
SELECT
  id,
  title,
  dedupe_key,
  source,
  url,
  summary,
  'en',
  published_at,
  is_sent,
  sent_at,
  created_at
FROM stock_news
WHERE source = 'Yahoo Finance'
ON CONFLICT (dedupe_key) DO UPDATE
SET
  is_sent = international_news.is_sent OR EXCLUDED.is_sent,
  sent_at = COALESCE(international_news.sent_at, EXCLUDED.sent_at);

DELETE FROM stock_news
WHERE source = 'Yahoo Finance';

COMMIT;
