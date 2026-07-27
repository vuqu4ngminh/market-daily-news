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
    const runMode = String(process.env.RUN_MODE || "LIVE").trim().toUpperCase();
    if (runMode !== "LIVE" && runMode !== "TEST") {
      throw new Error("RUN_MODE chỉ nhận giá trị TEST hoặc LIVE");
    }
    const isTestMode = runMode === "TEST";

    // TEST is intentional only for a manually started workflow. Do not resend
    // old news when GitHub reaches the scheduled trigger while this mode is set.
    if (isTestMode && process.env.GITHUB_EVENT_NAME === "schedule") {
      logger.info("[TEST] Bỏ qua lượt chạy theo lịch; hãy dùng Run workflow để kiểm tra.");
      return;
    }

    // Chế độ thực tế chỉ hoạt động trong khung giờ Việt Nam đã định.
    if (!isTestMode && (hourVN < 6 || hourVN > 23)) {
      logger.info(
        `Bên ngoài khung giờ gửi (Asia/Ho_Chi_Minh). Giờ hiện tại: ${hourVN}:00 — dừng.`
      );
      return;
    }

    if (isTestMode) {
      logger.info("[TEST] Gửi lại tin gần đây ngay, kể cả các tin đã gửi.");
    }

    const repo = new StockNewsRepository(
      config.supabase.url,
      config.supabase.serviceRoleKey
    );

    // Dùng luồng headline-only, không cần theo mã cổ phiếu cụ thể
    await repo.addTrackedStock("GENERAL", "Tin tức chung");

    const windowHours = isTestMode ? 6 : Math.max(1, config.newsWindowHours || 3);
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
    const unsent = isTestMode
      ? await repo.getNewsForTesting(windowHours)
      : await repo.getUnsentNews(config.newsWindowHours);

    if (!unsent || unsent.length === 0) {
      logger.info(isTestMode ? "Không có tin nào để kiểm tra." : "Không có tin nào mới để gửi.");
      return;
    }

    if (isTestMode) {
      logger.info(`[TEST] Lấy ${unsent.length} tin (bao gồm cả đã gửi) để test gửi lại.`);
    }

    // Gửi toàn bộ danh sách. Khi quá giới hạn Telegram, tin được chia thành nhiều phần.
    const messages = formatNewsMessage(unsent);
    for (const message of messages) {
      await sendTelegramMessage(
        config.telegram.token,
        config.telegram.chatId,
        message
      );
    }

    // Đánh dấu đã gửi
    const ids = unsent
      .filter((n) => !n.is_sent)
      .map((n) => n.id!)
      .filter(Boolean) as string[];
    await repo.markAsSent(ids);

    logger.info(`Đã gửi và đánh dấu ${ids.length} tin.`);
  } catch (error) {
    if (error instanceof Error) {
      logger.error({
        message: error.message,
        stack: error.stack,
      });
    } else {
      logger.error({ error });
    }

    process.exit(1);
  }
}

// Nếu chạy trực tiếp
if (process.env.NODE_ENV !== "test") {
  main().catch((e) => {
    logger.error({ e }, "Unhandled error");
    process.exit(1);
  });
}
