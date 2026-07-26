Thiết lập Supabase cho dự án Market Daily News

1) Tạo project trên Supabase (https://app.supabase.com)

2) Tạo extension uuid (nếu muốn gen_random_uuid):
   - Trong SQL Editor của Supabase, chạy:
     CREATE EXTENSION IF NOT EXISTS pgcrypto;

3) Chạy file migrations/create_tables.sql trong SQL Editor để tạo các bảng:
   - tracked_stocks: danh sách mã theo dõi
   - stock_news: lưu tin tức (unique trên (lower(title), stock_symbol))

4) Thiết lập Role/Key và Secrets
   - Tốt nhất: tạo SERVICE_ROLE key trong Project Settings -> API
   - Trong GitHub repository, thêm secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID

5) Cách hoạt động
   - GitHub Actions chạy mỗi giờ (cron) và gọi dist/index.js
   - Script sẽ kiểm tra giờ ở timezone Asia/Ho_Chi_Minh và chỉ gửi tin trong khung 06:00–23:00
   - Tin mới được crawl từ các RSS, lưu vào bảng stock_news (is_sent=false)
   - Sau khi gửi, script đánh dấu is_sent=true và lưu sent_at

6) Ghi chú chi tiết schema
   - tracked_stocks(symbol PK text, name text, is_active boolean, created_at timestamptz)
   - stock_news(id uuid PK, stock_symbol text, title text, source text, url text, summary text, published_at timestamptz, is_sent boolean default false, sent_at timestamptz, created_at timestamptz)
