-- Danh sách nguồn RSS mặc định cho Market Daily News.
-- File có thể chạy lại an toàn: mỗi nguồn được thêm mới hoặc cập nhật theo code.

BEGIN;

-- Tương thích với database v2 được tạo trước khi có nhóm Telegram.
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
    'stockbiz',
    'StockBiz',
    'rss',
    'https://web.stockbiz.vn/RSS/News/All.ashx',
    'https://stockbiz.vn',
    'VN', 'vi', false, true, 10, 'StockBiz', 120,
    '{"detectTickerPrefix": true}'::jsonb
  ),
  (
    'vneconomy_finance',
    'VnEconomy - Tài chính',
    'rss',
    'https://vneconomy.vn/tai-chinh.rss',
    'https://vneconomy.vn',
    'VN', 'vi', false, true, 20, 'VnEconomy', 120,
    '{"detectTickerPrefix": false}'::jsonb
  ),
  (
    'vneconomy_securities',
    'VnEconomy - Chứng khoán',
    'rss',
    'https://vneconomy.vn/chung-khoan.rss',
    'https://vneconomy.vn',
    'VN', 'vi', false, true, 20, 'VnEconomy', 120,
    '{"detectTickerPrefix": false}'::jsonb
  ),
  (
    'vnbusiness_stocks',
    'VnBusiness - Cổ phiếu',
    'rss',
    'https://vnbusiness.vn/rss/co-phieu.rss',
    'https://vnbusiness.vn',
    'VN', 'vi', false, true, 30, 'VnBusiness', 120,
    '{"detectTickerPrefix": true}'::jsonb
  ),
  (
    'cafef_securities',
    'CafeF - Thị trường chứng khoán',
    'rss',
    'https://cafef.vn/thi-truong-chung-khoan.rss',
    'https://cafef.vn',
    'VN', 'vi', false, true, 40, 'CafeF', 120,
    '{"detectTickerPrefix": false}'::jsonb
  ),
  (
    'yahoo_finance',
    'Yahoo Finance',
    'rss',
    'https://finance.yahoo.com/news/rss',
    'https://finance.yahoo.com',
    'US', 'en', true, true, 50, 'Yahoo', 120,
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
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  telegram_group = EXCLUDED.telegram_group,
  fetch_interval_minutes = EXCLUDED.fetch_interval_minutes,
  parser_config = EXCLUDED.parser_config,
  updated_at = now();

COMMIT;

SELECT
  code,
  name,
  feed_url,
  is_active,
  display_order,
  telegram_group
FROM public.news_sources
ORDER BY display_order, code;
