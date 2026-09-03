-- Market Daily News schema v2
-- This migration is additive: stock_news and international_news are left intact
-- so the previous application version can still be restored safely.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tracked_stocks (
  symbol text PRIMARY KEY,
  name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.news_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  source_type text NOT NULL DEFAULT 'rss'
    CHECK (source_type IN ('rss', 'api', 'scraper')),
  feed_url text NOT NULL,
  website_url text,
  country_code text,
  language_code text NOT NULL DEFAULT 'vi',
  is_international boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  fetch_interval_minutes integer NOT NULL DEFAULT 120
    CHECK (fetch_interval_minutes > 0),
  parser_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL
    REFERENCES public.news_sources(id)
    ON DELETE RESTRICT,
  original_title text NOT NULL,
  translated_title text,
  display_title text,
  summary text,
  canonical_url text,
  external_id text,
  dedupe_key text NOT NULL,
  region text NOT NULL
    CHECK (region IN ('domestic', 'international')),
  original_language text NOT NULL DEFAULT 'vi',
  status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'hidden', 'archived')),
  is_economic boolean,
  ai_processed boolean NOT NULL DEFAULT false,
  ai_model text,
  ai_confidence numeric(4,3)
    CHECK (ai_confidence IS NULL OR ai_confidence BETWEEN 0 AND 1),
  ai_error text,
  published_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS public.article_stocks (
  article_id uuid NOT NULL
    REFERENCES public.articles(id)
    ON DELETE CASCADE,
  stock_symbol text NOT NULL
    REFERENCES public.tracked_stocks(symbol)
    ON DELETE RESTRICT,
  detected_by text NOT NULL DEFAULT 'rule'
    CHECK (detected_by IN ('rss', 'rule', 'gemini', 'manual')),
  confidence numeric(4,3)
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  is_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, stock_symbol)
);

CREATE TABLE IF NOT EXISTS public.delivery_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  channel_type text NOT NULL
    CHECK (channel_type IN ('telegram', 'email', 'webhook')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Older drafts did not contain the stable channel code used by the worker.
ALTER TABLE public.delivery_channels
  ADD COLUMN IF NOT EXISTS code text;

-- Reuse one existing Telegram channel as the default when possible.
WITH default_candidate AS (
  SELECT id
  FROM public.delivery_channels
  WHERE channel_type = 'telegram'
  ORDER BY is_active DESC, created_at ASC
  LIMIT 1
)
UPDATE public.delivery_channels
SET code = 'telegram_default'
WHERE id = (SELECT id FROM default_candidate)
  AND code IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.delivery_channels
    WHERE code = 'telegram_default'
  );

-- Give any remaining legacy channels a deterministic unique code.
UPDATE public.delivery_channels
SET code = 'legacy_' || replace(id::text, '-', '')
WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_channels_code_key
  ON public.delivery_channels (code);

ALTER TABLE public.delivery_channels
  ALTER COLUMN code SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.article_deliveries (
  article_id uuid NOT NULL
    REFERENCES public.articles(id)
    ON DELETE CASCADE,
  channel_id uuid NOT NULL
    REFERENCES public.delivery_channels(id)
    ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, channel_id)
);

CREATE TABLE IF NOT EXISTS public.crawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid
    REFERENCES public.news_sources(id)
    ON DELETE SET NULL,
  trigger_type text NOT NULL DEFAULT 'schedule'
    CHECK (trigger_type IN ('schedule', 'manual', 'test')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  items_found integer NOT NULL DEFAULT 0 CHECK (items_found >= 0),
  items_inserted integer NOT NULL DEFAULT 0 CHECK (items_inserted >= 0),
  items_duplicated integer NOT NULL DEFAULT 0 CHECK (items_duplicated >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Older drafts of schema v2 required source_id. A crawl run now represents
-- the whole workflow (which can contain several sources), so it must be nullable.
ALTER TABLE public.crawl_runs
  ALTER COLUMN source_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_published_at
  ON public.articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source_published
  ON public.articles (source_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_status_published
  ON public.articles (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_stocks_symbol
  ON public.article_stocks (stock_symbol, article_id);
CREATE INDEX IF NOT EXISTS idx_article_deliveries_pending
  ON public.article_deliveries (channel_id, status)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_crawl_runs_started_at
  ON public.crawl_runs (started_at DESC);

INSERT INTO public.news_sources (
  code, name, source_type, feed_url, website_url, country_code,
  language_code, is_international, parser_config
)
VALUES
  (
    'stockbiz', 'StockBiz', 'rss',
    'https://web.stockbiz.vn/RSS/News/All.ashx',
    'https://stockbiz.vn', 'VN', 'vi', false,
    '{"detectTickerPrefix": true}'::jsonb
  ),
  (
    'yahoo_finance', 'Yahoo Finance', 'rss',
    'https://finance.yahoo.com/news/rss',
    'https://finance.yahoo.com', 'US', 'en', true,
    '{"detectTickerPrefix": false}'::jsonb
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.delivery_channels (code, name, channel_type)
VALUES ('telegram_default', 'Telegram mặc định', 'telegram')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.news_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawl_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.news_sources,
  public.tracked_stocks,
  public.articles,
  public.article_stocks,
  public.delivery_channels,
  public.article_deliveries,
  public.crawl_runs
FROM anon, authenticated;

GRANT ALL ON TABLE
  public.news_sources,
  public.tracked_stocks,
  public.articles,
  public.article_stocks,
  public.delivery_channels,
  public.article_deliveries,
  public.crawl_runs
TO service_role;

COMMIT;
