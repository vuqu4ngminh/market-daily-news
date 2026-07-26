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

    const { data, error } = await this.client
      .from("stock_news")
      .upsert(newsItems, {
        onConflict: "title,stock_symbol",
        ignoreDuplicates: true,
      });

    if (error) {
      logger.error({ error }, "Lỗi khi lưu tin tức vào Supabase");
      throw error;
    }

    // Đếm số bản ghi thực sự được insert
    const { count } = await this.client
      .from("stock_news")
      .select("*", { count: "exact", head: true })
      .eq("is_sent", false);

    // Tính toán số duplicates dựa trên số lượng trả về
    // Note: upsert không trả về số lượng chính xác trong Supabase JS v2
    // Chúng ta sẽ ước tính
    logger.info(`Đã xử lý ${newsItems.length} tin tức`);
    return { inserted: newsItems.length, duplicates: 0 };
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
