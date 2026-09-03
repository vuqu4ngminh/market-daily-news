import getConfig, { resolveRunMode } from "./config/config.js";
import { StockNewsRepository } from "./database/supabase.js";
import { scrapeNews } from "./services/newsScraper.js";
import {
  formatNewsMessage,
  sendTelegramMessage,
} from "./services/telegram.js";
import { logger } from "./utils/logger.js";

async function main() {
  const startTime = Date.now();
  let repo: StockNewsRepository | undefined;
  let crawlRunId: string | undefined;
  let activeRunMode: "LIVE" | "TEST" | undefined;

  try {
    logger.info("====================================================");
    logger.info("🚀 Market Daily News bắt đầu chạy");

    // ===========================
    // STEP 1 - Đọc config
    // ===========================
    logger.info("[STEP 1/9] Đọc cấu hình...");

    const config = getConfig();

    const runMode = resolveRunMode();
    activeRunMode = runMode;
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
    // STEP 2 - Ghi nhận thời gian chạy
    // ===========================
    logger.info("[STEP 2/9] Ghi nhận thời gian chạy 24/7...");

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

    if (isTestMode) {
      logger.info(
        "[TEST] Sẽ gửi lại các tin gần đây kể cả đã gửi."
      );
    }

    // ===========================
    // STEP 3 - Kết nối Supabase
    // ===========================
    logger.info("[STEP 3/9] Khởi tạo Supabase...");

    repo = new StockNewsRepository(
      config.supabase.url,
      config.supabase.serviceRoleKey
    );

    logger.info("✅ Kết nối Supabase thành công.");

    // ===========================
    // STEP 4 - Đọc nguồn tin từ schema v2
    // ===========================
    logger.info("[STEP 4/9] Đọc nguồn tin đang bật...");

    const newsSources = await repo.getActiveNewsSources();
    if (newsSources.length === 0) {
      throw new Error(
        "Không có nguồn tin đang bật trong bảng news_sources"
      );
    }

    logger.info(
      { sources: newsSources.map((source) => source.code) },
      `✅ Đã tải ${newsSources.length} nguồn tin.`
    );

    // ===========================
    // STEP 5 - Crawl
    // ===========================
    const windowHours = isTestMode
      ? 6
      : Math.max(1, config.newsWindowHours || 3);

    logger.info(
      `[STEP 5/9] Crawl RSS (${windowHours} giờ)...`
    );

    crawlRunId = await repo.startCrawlRun(
      isTestMode
        ? "test"
        : process.env.GITHUB_EVENT_NAME === "schedule"
          ? "schedule"
          : "manual"
    );

    const scraped = await scrapeNews(windowHours, newsSources);

    await repo.markSourcesFetched(
      newsSources.map((source) => source.id)
    );

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

    }

    await repo.completeCrawlRun(crawlRunId, {
      found: scraped.length,
      inserted,
      duplicates,
    });
    crawlRunId = undefined;

    // ===========================
    // STEP 6 - Lấy tin
    // ===========================
    logger.info("[STEP 6/9] Lấy danh sách tin sẽ gửi...");

    // TEST sends the freshly scraped list directly, even when every item was
    // already present in Supabase. Fall back to recent DB rows if RSS is empty.
    const newsToSend = isTestMode
      ? scraped.length > 0
        ? scraped
        : await repo.getNewsForTesting(windowHours)
      : await repo.getUnsentNews(windowHours);

    logger.info(
      `Lấy được ${newsToSend.length} tin.`
    );

    if (newsToSend.length === 0) {
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

    const messages = formatNewsMessage(newsToSend);

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

    let markedSentCount = 0;

    if (isTestMode) {
      logger.info(
        "[TEST] Không cập nhật is_sent; các tin vẫn có thể được gửi trong LIVE."
      );
    } else {
      const ids = newsToSend
        .filter((n) => !n.is_sent)
        .map((n) => n.id!)
        .filter(Boolean) as string[];

      await repo.markAsSent(ids);
      markedSentCount = ids.length;

      logger.info(
        `✅ Hoàn tất. Đánh dấu ${markedSentCount} tin đã gửi.`
      );
    }

    logger.info({
      mode: runMode,
      scraped: scraped.length,
      inserted,
      duplicates,
      telegramMessages: messages.length,
      sentNews: newsToSend.length,
      markedSent: markedSentCount,
      elapsedMs: Date.now() - startTime,
    }, "🏁 Job hoàn thành");
  } catch (error) {
    if (repo && crawlRunId) {
      await repo.failCrawlRun(crawlRunId, error);
    }

    logger.error("====================================================");
    logger.error("❌ Gửi tin tức thất bại");

    if (error instanceof Error) {
      logger.error(
        {
          err: error,
          mode: activeRunMode,
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
      mode: activeRunMode,
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
