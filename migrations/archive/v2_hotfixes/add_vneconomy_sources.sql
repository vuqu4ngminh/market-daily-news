-- Add VnEconomy RSS feeds and Telegram source ordering.
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.news_sources
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 100;
ALTER TABLE public.news_sources
  ADD COLUMN IF NOT EXISTS telegram_group text;

INSERT INTO public.news_sources (
  code,
  name,
  source_type,
  feed_url,
  website_url,
  country_code,
  language_code,
  is_international,
  is_active,
  display_order,
  telegram_group,
  fetch_interval_minutes,
  parser_config
)
VALUES
  (
    'vneconomy_finance',
    'VnEconomy - Tài chính',
    'rss',
    'https://vneconomy.vn/tai-chinh.rss',
    'https://vneconomy.vn',
    'VN',
    'vi',
    false,
    true,
    20,
    'VnEconomy',
    120,
    '{"detectTickerPrefix": false}'::jsonb
  ),
  (
    'vneconomy_securities',
    'VnEconomy - Chứng khoán',
    'rss',
    'https://vneconomy.vn/chung-khoan.rss',
    'https://vneconomy.vn',
    'VN',
    'vi',
    false,
    true,
    20,
    'VnEconomy',
    120,
    '{"detectTickerPrefix": false}'::jsonb
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  source_type = EXCLUDED.source_type,
  feed_url = EXCLUDED.feed_url,
  website_url = EXCLUDED.website_url,
  country_code = EXCLUDED.country_code,
  language_code = EXCLUDED.language_code,
  is_international = EXCLUDED.is_international,
  is_active = true,
  display_order = EXCLUDED.display_order,
  telegram_group = EXCLUDED.telegram_group,
  fetch_interval_minutes = EXCLUDED.fetch_interval_minutes,
  parser_config = EXCLUDED.parser_config,
  updated_at = now();

UPDATE public.news_sources
SET display_order = 10, telegram_group = 'StockBiz', updated_at = now()
WHERE code = 'stockbiz';

UPDATE public.news_sources
SET display_order = 30, telegram_group = 'Yahoo', updated_at = now()
WHERE code = 'yahoo_finance';

COMMIT;

SELECT code, name, feed_url, display_order, telegram_group, is_active
FROM public.news_sources
ORDER BY display_order, code;
