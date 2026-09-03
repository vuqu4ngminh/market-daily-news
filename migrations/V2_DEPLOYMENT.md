# Triển khai schema v2

Schema v2 không xóa hoặc đổi tên `stock_news` và `international_news`. Vì các
bảng cũ vẫn còn nguyên, có thể rollback code về commit trước mà không cần
rollback database.

## Thứ tự triển khai

1. Mở Supabase Dashboard > SQL Editor.
2. Chạy toàn bộ file `create_v2_schema.sql` và kiểm tra kết quả thành công.
3. Kiểm tra các nguồn `stockbiz`, `vneconomy_finance`,
   `vneconomy_securities`, `yahoo_finance` trong `news_sources` và kênh
   `telegram_default` trong `delivery_channels`.
4. Commit và push code mới lên GitHub.
5. Chạy workflow thủ công một lần. Workflow thủ công là TEST mode nên có thể
   gửi ngay cả khi tin đã được gửi trước đó.
6. Kiểm tra `articles`, `article_stocks` và `article_deliveries` trước khi chờ
   lượt LIVE kế tiếp.

## Kiểm tra nhanh

```sql
select code, name, is_active from public.news_sources order by code;

select code, name, is_active from public.delivery_channels order by code;

select count(*) as articles from public.articles;

select status, count(*)
from public.article_deliveries
group by status
order by status;
```

## Rollback code

Rollback hoặc revert commit triển khai v2 trên GitHub. Phiên bản cũ sẽ tiếp tục
dùng `stock_news` và `international_news`. Không cần xóa bảng v2; để chúng lại
giúp giữ dữ liệu đã thu thập trong thời gian thử nghiệm.

Không chạy `DROP TABLE` trong quá trình rollback.

## Bổ sung VnEconomy và thứ tự Telegram

Với database v2 đã tồn tại, chạy file `add_vneconomy_sources.sql`. File này
thêm hai RSS VnEconomy và các cột `display_order`, `telegram_group` dùng để hiển
thị theo nhóm `StockBiz -> VnEconomy -> Yahoo`.

## Lỗi `crawl_runs.source_id violates not-null constraint`

Nếu `crawl_runs` đã được tạo từ bản thiết kế cũ, chạy file
`fix_crawl_runs_source_nullable.sql`. Lượt chạy hiện tại đại diện cho toàn bộ
workflow và có thể chứa nhiều nguồn, nên `source_id` của lượt chạy tổng hợp được
phép để trống.

## Lỗi `delivery_channels.code does not exist`

Nếu bảng `delivery_channels` đã được tạo từ bản thiết kế cũ chưa có cột `code`,
chạy file `fix_delivery_channels_code.sql`. Migration sẽ dùng lại một kênh
Telegram hiện có làm `telegram_default`; các kênh cũ khác vẫn được giữ nguyên.
