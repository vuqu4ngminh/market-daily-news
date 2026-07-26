import getConfig from "./config/config.js";
import { StockNewsRepository } from "./database/supabase.js";
import { scrapeNews } from "./services/newsScraper.js";
import {
  formatNewsMessage,
  sendTelegramMessage,
} from "./services/telegram.js";
import { logger } from "./utils/logger.js";

async function main() {
  try {
    const config = getConfig();

    // Giờ hiện tại theo timezone VN
    const now = new Date();
    const nowVN = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })
    );
    const hourVN = nowVN.getHours();
    const skipTimeWindow = ["1", "true", "yes", "on"].includes(
      String(process.env.SKIP_TIME_WINDOW || process.env.RUN_NOW || "")
        .toLowerCase()
    );

    // Chỉ chạy từ 6h đến 23h (inclusive), trừ khi bật cờ test
    if (!skipTimeWindow && (hourVN < 6 || hourVN > 23)) {
      logger.info(
        `Bên ngoài khung giờ gửi (Asia/Ho_Chi_Minh). Giờ hiện tại: ${hourVN}:00 — dừng.`
      );
      return;
    }

    if (skipTimeWindow) {
      logger.info("Bỏ qua kiểm tra khung giờ vì đã bật SKIP_TIME_WINDOW/RUN_NOW.");
    }

    const repo = new StockNewsRepository(
      config.supabase.url,
      config.supabase.serviceRoleKey
    );

    // Dùng luồng headline-only, không cần theo mã cổ phiếu cụ thể
    await repo.addTrackedStock("GENERAL", "Tin tức chung");

    const windowHours = Math.max(1, config.newsWindowHours || 1);
    logger.info(`Đang quét tin mới trong vòng ${windowHours} giờ`);

    // Crawl tin
    const scraped = await scrapeNews(windowHours);

    if (scraped.length === 0) {
      logger.info("Không tìm thấy tin mới từ các nguồn RSS.");
    } else {
      logger.info(`Tìm thấy ${scraped.length} tin liên quan. Lưu vào DB...`);

      await repo.upsertNews(scraped);
    }

    // Lấy các tin chưa gửi trong khoảng window
    const unsent = await repo.getUnsentNews(config.newsWindowHours);
    if (!unsent || unsent.length === 0) {
      logger.info("Không có tin nào chưa được gửi.");
      return;
    }

    // Gửi telegram (gộp vào 1 message)
    const message = formatNewsMessage(unsent);
    await sendTelegramMessage(
      config.telegram.token,
      config.telegram.chatId,
      message
    );

    // Đánh dấu đã gửi
    const ids = unsent.map((n) => n.id!).filter(Boolean) as string[];
    await repo.markAsSent(ids);

    logger.info(`Đã gửi và đánh dấu ${ids.length} tin.`);
  } catch (error) {
    logger.error({ error }, "Lỗi không mong muốn trong tiến trình chính");
    process.exitCode = 1;
  }
}

// Nếu chạy trực tiếp
if (process.env.NODE_ENV !== "test") {
  main().catch((e) => {
    logger.error({ e }, "Unhandled error");
    process.exit(1);
  });
}
