-- Apply this migration to existing Supabase projects after create_tables.sql.

ALTER TABLE stock_news
  ADD COLUMN IF NOT EXISTS dedupe_key text;

UPDATE stock_news
SET dedupe_key = 'legacy:' || id::text
WHERE dedupe_key IS NULL;

ALTER TABLE stock_news
  ALTER COLUMN dedupe_key SET NOT NULL;

ALTER TABLE stock_news
  DROP CONSTRAINT IF EXISTS stock_news_dedupe_key_key;

ALTER TABLE stock_news
  ADD CONSTRAINT stock_news_dedupe_key_key UNIQUE (dedupe_key);

DROP INDEX IF EXISTS uq_stocknews_title_symbol;
