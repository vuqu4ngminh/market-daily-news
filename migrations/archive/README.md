# SQL lưu trữ

Các file trong thư mục này được giữ lại để theo dõi lịch sử và hỗ trợ các
database đã triển khai từ phiên bản cũ. Không chạy chúng khi cài đặt mới.

- `v1/`: schema và thay đổi dành cho các bảng v1.
- `v2_hotfixes/`: bản vá một lần cho các bản schema v2 cũ.

Với cài đặt mới, chỉ cần chạy theo thứ tự:

1. `../create_v2_schema.sql`
2. `../seed_news_sources.sql`
