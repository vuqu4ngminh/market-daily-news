import { createClient } from "@supabase/supabase-js";
import type { StockNews, TrackedStock } from "../types/index.js";
import { writeInternationalNewsLog } from "../utils/internationalNewsLog.js";
import { logger } from "../utils/logger.js";

export class StockNewsRepository {
  private client;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  /**
   * Lưu tin trong nước vào stock_news và tin quốc tế vào international_news.
   * Upsert với ignoreDuplicates tránh phát sinh lỗi PostgreSQL 23505.
   */
  async upsertNews(newsItems: StockNews[]): Promise<{
    inserted: number;
    duplicates: number;
  }> {
    if (newsItems.length === 0) return { inserted: 0, duplicates: 0 };

    const domesticItems = newsItems.filter((item) => !item.is_international);

    // stock_news references tracked_stocks. Create every newly detected ticker
    // before inserting its news so the foreign-key constraint is satisfied.
    const symbols = [
      ...new Set(
        domesticItems.map((item) => item.stock_symbol.toUpperCase())
      ),
    ];

    if (symbols.length > 0) {
      const { error: stockError } = await this.client
        .from("tracked_stocks")
        .upsert(
          symbols.map((symbol) => ({
            symbol,
            name: symbol === "GENERAL" ? "Tin tức chung" : symbol,
            is_active: true,
          })),
          { onConflict: "symbol", ignoreDuplicates: true }
        );

      if (stockError) {
        logger.error(
          { error: stockError, symbols },
          "Lỗi khi tạo mã cổ phiếu mới"
        );
        throw stockError;
      }
    }

    let inserted = 0;
    let duplicates = 0;

    for (const item of newsItems) {
      const table = item.is_international
        ? "international_news"
        : "stock_news";

      const payload = item.is_international
        ? {
            title: item.title,
            dedupe_key: item.dedupe_key,
            source: item.source,
            url: item.url,
            summary: item.summary,
            original_language: item.original_language || "en",
            published_at: item.published_at,
            is_sent: item.is_sent ?? false,
          }
        : {
            stock_symbol: item.stock_symbol,
            title: item.title,
            dedupe_key: item.dedupe_key,
            source: item.source,
            url: item.url,
            summary: item.summary,
            published_at: item.published_at,
            is_sent: item.is_sent ?? false,
          };

      try {
        const { data, error } = await this.client
          .from(table)
          .upsert(payload as any, {
            onConflict: "dedupe_key",
            ignoreDuplicates: true,
          })
          .select("id");

        if (error) {
          logger.error(
            { error, item, table },
            "Lỗi khi lưu tin tức vào Supabase"
          );
          if (item.is_international) {
            writeInternationalNewsLog("DATABASE_INSERT_FAILED", {
              source: item.source,
              table,
              title: item.title,
              publishedAt: item.published_at,
              code: (error as any).code,
              message: (error as any).message,
              details: (error as any).details,
              hint: (error as any).hint,
            });
          }
          throw error;
        }

        if (data && data.length > 0) {
          inserted++;
        } else {
          duplicates++;
          logger.debug(
            { title: item.title, table },
            "Tin đã tồn tại, bỏ qua"
          );
        }
      } catch (err) {
        logger.error(
          { err, item, table },
          "Lỗi không mong muốn khi lưu tin"
        );
        if (item.is_international) {
          writeInternationalNewsLog("DATABASE_INSERT_FAILED", {
            source: item.source,
            table,
            title: item.title,
            publishedAt: item.published_at,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        throw err;
      }
    }

    logger.info(
      `Đã xử lý ${newsItems.length} tin tức (inserted=${inserted}, duplicates=${duplicates})`
    );
    return { inserted, duplicates };
  }

  /**
   * Lấy các tin chưa gửi, trong khoảng thời gian quy định
   */
  async getUnsentNews(windowHours: number): Promise<StockNews[]> {
    const since = new Date(
      Date.now() - windowHours * 60 * 60 * 1000
    ).toISOString();

    const [domesticResult, internationalResult] = await Promise.all([
      this.client
        .from("stock_news")
        .select("*")
        .eq("is_sent", false)
        .gte("published_at", since),
      this.client
        .from("international_news")
        .select("*")
        .eq("is_sent", false),
    ]);

    if (domesticResult.error || internationalResult.error) {
      const error = domesticResult.error || internationalResult.error;
      logger.error({ error }, "Lỗi khi lấy tin chưa gửi");
      throw error;
    }

    return this.mergeNews(
      domesticResult.data || [],
      internationalResult.data || []
    );
  }

  /**
   * Lấy tất cả tin (kể cả đã gửi), dùng cho test
   */
  async getNewsForTesting(windowHours: number): Promise<StockNews[]> {
    const since = new Date(
      Date.now() - windowHours * 60 * 60 * 1000
    ).toISOString();

    const [domesticResult, internationalResult] = await Promise.all([
      this.client
        .from("stock_news")
        .select("*")
        .gte("published_at", since),
      this.client
        .from("international_news")
        .select("*"),
    ]);

    if (domesticResult.error || internationalResult.error) {
      const error = domesticResult.error || internationalResult.error;
      logger.error({ error }, "Lỗi khi lấy tin cho test");
      throw error;
    }

    return this.mergeNews(
      domesticResult.data || [],
      internationalResult.data || []
    );
  }

  private mergeNews(domestic: any[], international: any[]): StockNews[] {
    const internationalItems: StockNews[] = international.map((item) => ({
      ...item,
      title: item.translated_title || item.title,
      stock_symbol: "GENERAL",
      is_international: true,
      original_language: item.original_language || "en",
    }));

    return [...domestic, ...internationalItems].sort((a, b) => {
      const aTime = a.published_at ? new Date(a.published_at).getTime() : 0;
      const bTime = b.published_at ? new Date(b.published_at).getTime() : 0;
      return bTime - aTime;
    });
  }


  /**
   * Đánh dấu tin đã gửi
   */
  async markAsSent(newsIds: string[]): Promise<void> {
    if (newsIds.length === 0) return;

    const sentAt = new Date().toISOString();
    const [domesticResult, internationalResult] = await Promise.all([
      this.client
        .from("stock_news")
        .update({ is_sent: true, sent_at: sentAt })
        .in("id", newsIds),
      this.client
        .from("international_news")
        .update({ is_sent: true, sent_at: sentAt })
        .in("id", newsIds),
    ]);

    if (domesticResult.error || internationalResult.error) {
      const error = domesticResult.error || internationalResult.error;
      logger.error({ error }, "Lỗi khi đánh dấu tin đã gửi");
      throw error;
    }

    logger.info(`Đã đánh dấu ${newsIds.length} tin là đã gửi`);
  }

  /**
   * Lấy danh sách mã cổ phiếu đang theo dõi từ DB
   */
  async getTrackedStocks(): Promise<TrackedStock[]> {
    const { data, error } = await this.client
      .from("tracked_stocks")
      .select("*")
      .eq("is_active", true);

    if (error) {
      logger.error({ error }, "Lỗi khi lấy danh sách cổ phiếu");
      throw error;
    }

    return data || [];
  }

  /**
   * Thêm mã cổ phiếu mới (nếu chưa có)
   */
  async addTrackedStock(symbol: string, name?: string): Promise<void> {
    const { error } = await this.client.from("tracked_stocks").upsert(
      {
        symbol: symbol.toUpperCase(),
        name: name || symbol.toUpperCase(),
        is_active: true,
      },
      { onConflict: "symbol" }
    );

    if (error) {
      logger.error({ error, symbol }, "Lỗi khi thêm cổ phiếu");
      throw error;
    }
  }
}
