import { createClient } from "@supabase/supabase-js";
import type { StockNews, TrackedStock } from "../types/index.js";
import { logger } from "../utils/logger.js";

export class StockNewsRepository {
  private client;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  /**
   * Lưu tin tức mới, bỏ qua nếu đã tồn tại (unique title + symbol)
   */
  async upsertNews(newsItems: StockNews[]): Promise<{
    inserted: number;
    duplicates: number;
  }> {
    if (newsItems.length === 0) return { inserted: 0, duplicates: 0 };

    // stock_news references tracked_stocks. Create every newly detected ticker
    // before inserting its news so the foreign-key constraint is satisfied.
    const symbols = [...new Set(newsItems.map((item) => item.stock_symbol.toUpperCase()))];
    const { error: stockError } = await this.client.from("tracked_stocks").upsert(
      symbols.map((symbol) => ({
        symbol,
        name: symbol === "GENERAL" ? "Tin tức chung" : symbol,
        is_active: true,
      })),
      { onConflict: "symbol", ignoreDuplicates: true }
    );

    if (stockError) {
      logger.error({ error: stockError, symbols }, "Lỗi khi tạo mã cổ phiếu mới");
      throw stockError;
    }

    let inserted = 0;
    let duplicates = 0;

    for (const item of newsItems) {
      try {
        const { error } = await this.client.from("stock_news").insert(item);
        if (error) {
          const msg = String((error as any).message || "").toLowerCase();
          if ((error as any).code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
            duplicates++;
            logger.debug({ title: item.title, symbol: item.stock_symbol }, "Duplicate, skip");
            continue;
          }

          logger.error({ error, item }, "Lỗi khi lưu tin tức vào Supabase");
          throw error;
        }

        inserted++;
      } catch (err) {
        const msg = String((err as any).message || "").toLowerCase();
        if ((err as any).code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
          duplicates++;
          continue;
        }
        logger.error({ err, item }, "Lỗi không mong muốn khi insert tin");
        throw err;
      }
    }

    logger.info(`Đã xử lý ${newsItems.length} tin tức (inserted=${inserted}, duplicates=${duplicates})`);
    return { inserted, duplicates };
  }

  /**
   * Lấy các tin chưa gửi, trong khoảng thời gian quy định
   */
  async getUnsentNews(windowHours: number): Promise<StockNews[]> {
    const since = new Date(
      Date.now() - windowHours * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await this.client
      .from("stock_news")
      .select("*")
      .eq("is_sent", false)
      .gte("published_at", since)
      .order("published_at", { ascending: false });

    if (error) {
      logger.error({ error }, "Lỗi khi lấy tin chưa gửi");
      throw error;
    }

    return data || [];
  }

  /**
   * Lấy tất cả tin (kể cả đã gửi), dùng cho test
   */
  async getNewsForTesting(windowHours: number): Promise<StockNews[]> {
    const since = new Date(
      Date.now() - windowHours * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await this.client
      .from("stock_news")
      .select("*")
      .gte("published_at", since)
      .order("published_at", { ascending: false });

    if (error) {
      logger.error({ error }, "Lỗi khi lấy tin cho test");
      throw error;
    }

    return data || [];
  }


  /**
   * Đánh dấu tin đã gửi
   */
  async markAsSent(newsIds: string[]): Promise<void> {
    if (newsIds.length === 0) return;

    const { error } = await this.client
      .from("stock_news")
      .update({ is_sent: true, sent_at: new Date().toISOString() })
      .in("id", newsIds);

    if (error) {
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
