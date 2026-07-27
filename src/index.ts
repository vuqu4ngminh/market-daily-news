import getConfig from "./config/config.js";
import { StockNewsRepository } from "./database/supabase.js";
import { scrapeNews } from "./services/newsScraper.js";
import {
  formatNewsMessage,
  sendTelegramMessage,
} from "./services/telegram.js";
import { logger } from "./utils/logger.js";

async function main() {
  const startTime = Date.now();

  try {
    logger.info("====================================================");
    logger.info("🚀 Market Daily News bắt đầu chạy");

    // ===========================
    // STEP 1 - Đọc config
    // ===========================
    logger.info("[STEP 1/9] Đọc cấu hình...");

    const config = getConfig();

    const runMode = String(process.env.RUN_MODE || "LIVE")
      .trim()
      .toUpperCase();

    if (runMode !== "LIVE" && runMode !== "TEST") {
      throw new Error("RUN_MODE chỉ nhận giá trị TEST hoặc LIVE");
    }

    const isTestMode = runMode === "TEST";

    logger.info(
      {
        runMode,
        githubEvent: process.env.GITHUB_EVENT_NAME,
        nodeVersion: process.version,
        windowHours:
          isTestMode
            ? 6
            : Math.max(1, config.newsWindowHours || 3),
        timezone: "Asia/Ho_Chi_Minh",
      },
      runMode === "TEST"
        ? "🧪 TEST MODE"
        : "🚀 LIVE MODE"
    );

    // ===========================
    // STEP 2 - Kiểm tra thời gian
    // ===========================
    logger.info("[STEP 2/9] Kiểm tra khung giờ chạy...");

    const now = new Date();
    const nowVN = new Date(
      now.toLocaleString("en-US", {
        timeZone: "Asia/Ho_Chi_Minh",
      })
    );

    const hourVN = nowVN.getHours();

    logger.info({
      utcTime: now.toISOString(),
      vietnamTime: nowVN.toString(),
      hourVN,
    });

    if (
      isTestMode &&
      process.env.GITHUB_EVENT_NAME === "schedule"
    ) {
      logger.info(
        "[TEST] Workflow được trigger theo schedule -> bỏ qua."
      );
      return;
    }

    if (!isTestMode && (hourVN < 6 || hourVN > 23)) {
      logger.info(
        `Ngoài khung giờ gửi (${hourVN}:00 VN) -> kết thúc.`
      );
      return;
    }

    if (isTestMode) {
      logger.info(
        "[TEST] Sẽ gửi lại các tin gần đây kể cả đã gửi."
      );
    }

    // ===========================
    // STEP 3 - Kết nối Supabase
    // ===========================
    logger.info("[STEP 3/9] Khởi tạo Supabase...");

    const repo = new StockNewsRepository(
      config.supabase.url,
      config.supabase.serviceRoleKey
    );

    logger.info("✅ Kết nối Supabase thành công.");

    // ===========================
    // STEP 4 - Chuẩn bị dữ liệu
    // ===========================
    logger.info("[STEP 4/9] Kiểm tra mã GENERAL...");

    await repo.addTrackedStock("GENERAL", "Tin tức chung");

    logger.info("✅ GENERAL đã sẵn sàng.");

    // ===========================
    // STEP 5 - Crawl
    // ===========================
    const windowHours = isTestMode
      ? 6
      : Math.max(1, config.newsWindowHours || 3);

    logger.info(
      `[STEP 5/9] Crawl RSS (${windowHours} giờ)...`
    );

    const scraped = await scrapeNews(windowHours);

    logger.info(
      `Scraper trả về ${scraped.length} tin.`
    );

    let inserted = 0;
    let duplicates = 0;

    if (scraped.length > 0) {
      logger.info("Đang lưu dữ liệu vào Supabase...");

      const result = await repo.upsertNews(scraped);

      inserted = result.inserted;
      duplicates = result.duplicates;

      logger.info({
        inserted,
        duplicates,
      });

      // LIVE: không có tin mới thì dừng luôn
      if (!isTestMode && inserted === 0) {
        logger.info(
          "Không phát hiện tin mới trong RSS. Bỏ qua bước lấy dữ liệu và gửi Telegram."
        );

        logger.info({
          elapsedMs: Date.now() - startTime,
        }, "🏁 Job hoàn thành.");

        return;
      }
    }

    // ===========================
    // STEP 6 - Lấy tin
    // ===========================
    logger.info("[STEP 6/9] Lấy danh sách tin sẽ gửi...");

    const unsent = isTestMode
      ? await repo.getNewsForTesting(windowHours)
      : await repo.getUnsentNews(windowHours);

    logger.info(
      `Lấy được ${unsent.length} tin.`
    );

    if (unsent.length === 0) {
      logger.info(
        isTestMode
          ? "[TEST] Không có tin để test."
          : "Không có tin mới để gửi."
      );
      return;
    }

    // ===========================
    // STEP 7 - Format
    // ===========================
    logger.info("[STEP 7/9] Format Telegram...");

    const messages = formatNewsMessage(unsent);

    logger.info(
      `Tin được chia thành ${messages.length} message Telegram.`
    );

    // ===========================
    // STEP 8 - Gửi Telegram
    // ===========================
    logger.info("[STEP 8/9] Gửi Telegram...");

    for (let i = 0; i < messages.length; i++) {
      logger.info({
        current: i + 1,
        total: messages.length,
        length: messages[i].length,
      }, "Đang gửi Telegram");

      await sendTelegramMessage(
        config.telegram.token,
        config.telegram.chatId,
        messages[i]
      );
    }

    // ===========================
    // STEP 9 - Mark Sent
    // ===========================
    logger.info("[STEP 9/9] Đánh dấu đã gửi...");

    const ids = unsent
      .filter((n) => !n.is_sent)
      .map((n) => n.id!)
      .filter(Boolean) as string[];

    await repo.markAsSent(ids);

    logger.info(
      `✅ Hoàn tất. Đánh dấu ${ids.length} tin đã gửi.`
    );

    logger.info({
      mode: runMode,
      scraped: scraped.length,
      inserted,
      duplicates,
      telegramMessages: messages.length,
      sentNews: ids.length,
      elapsedMs: Date.now() - startTime,
    }, "🏁 Job hoàn thành");
  } catch (error) {
    logger.error("====================================================");
    logger.error("❌ Gửi tin tức thất bại");

    if (error instanceof Error) {
      logger.error(
        {
          err: error,
          mode: process.env.RUN_MODE,
          githubEvent: process.env.GITHUB_EVENT_NAME,
          elapsedMs: Date.now() - startTime,
        },
        "❌ Market Daily News FAILED"
      );
    } else {
      logger.error({
        error,
      });
    }

    logger.error({
      elapsedMs: Date.now() - startTime,
      mode: process.env.RUN_MODE,
      githubEvent: process.env.GITHUB_EVENT_NAME,
    });

    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    logger.fatal({
      error,
    }, "Unhandled Promise Rejection");

    process.exit(1);
  });
}