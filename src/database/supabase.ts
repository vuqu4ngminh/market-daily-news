import { createClient } from "@supabase/supabase-js";
import type {
  NewsSource,
  StockNews,
  TrackedStock,
} from "../types/index.js";
import { writeInternationalNewsLog } from "../utils/internationalNewsLog.js";
import { logger } from "../utils/logger.js";

const DEFAULT_CHANNEL_CODE = "telegram_default";
const STOCK_SYMBOL_PATTERN = /^[A-Z]{3}$/;

export class StockNewsRepository {
  private client;
  private defaultChannelId?: string;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  async getActiveNewsSources(): Promise<NewsSource[]> {
    const { data, error } = await this.client
      .from("news_sources")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) {
      logger.error({ error }, "Lỗi khi lấy danh sách nguồn tin");
      throw error;
    }

    return (data || []) as NewsSource[];
  }

  async upsertNews(newsItems: StockNews[]): Promise<{
    inserted: number;
    duplicates: number;
  }> {
    if (newsItems.length === 0) return { inserted: 0, duplicates: 0 };

    const symbols = [
      ...new Set(
        newsItems.flatMap((item) => this.extractSymbols(item.stock_symbol))
      ),
    ];

    if (symbols.length > 0) {
      const { error } = await this.client.from("tracked_stocks").upsert(
        symbols.map((symbol) => ({
          symbol,
          name: symbol,
          is_active: true,
        })),
        { onConflict: "symbol", ignoreDuplicates: true }
      );

      if (error) {
        logger.error({ error, symbols }, "Lỗi khi tạo mã cổ phiếu mới");
        throw error;
      }
    }

    const channelId = await this.getDefaultChannelId();
    let inserted = 0;
    let duplicates = 0;

    for (const item of newsItems) {
      if (!item.source_id) {
        throw new Error(`Nguồn ${item.source} không có source_id`);
      }
      if (!item.dedupe_key) {
        throw new Error(`Tin "${item.title}" không có dedupe_key`);
      }

      const payload = {
        source_id: item.source_id,
        original_title: item.title,
        display_title: item.title,
        summary: item.summary,
        canonical_url: item.url,
        dedupe_key: item.dedupe_key,
        region: item.is_international ? "international" : "domestic",
        original_language: item.original_language || "vi",
        status: "published",
        published_at: item.published_at,
        fetched_at: new Date().toISOString(),
      };

      try {
        const { data: insertedArticle, error: insertError } = await this.client
          .from("articles")
          .upsert(payload, {
            onConflict: "source_id,dedupe_key",
            ignoreDuplicates: true,
          })
          .select("id")
          .maybeSingle();

        if (insertError) throw insertError;

        let articleId = insertedArticle?.id as string | undefined;
        if (articleId) {
          inserted++;
        } else {
          duplicates++;
          const { data: existingArticle, error: lookupError } = await this.client
            .from("articles")
            .select("id")
            .eq("source_id", item.source_id)
            .eq("dedupe_key", item.dedupe_key)
            .single();

          if (lookupError) throw lookupError;
          articleId = existingArticle.id as string;
        }

        const articleSymbols = this.extractSymbols(item.stock_symbol);
        if (articleSymbols.length > 0) {
          const { error: symbolError } = await this.client
            .from("article_stocks")
            .upsert(
              articleSymbols.map((stockSymbol) => ({
                article_id: articleId,
                stock_symbol: stockSymbol,
                detected_by: "rss",
                confidence: 1,
                is_confirmed: true,
              })),
              {
                onConflict: "article_id,stock_symbol",
                ignoreDuplicates: true,
              }
            );

          if (symbolError) throw symbolError;
        }

        const { error: deliveryError } = await this.client
          .from("article_deliveries")
          .upsert(
            {
              article_id: articleId,
              channel_id: channelId,
              status: "pending",
            },
            {
              onConflict: "article_id,channel_id",
              ignoreDuplicates: true,
            }
          );

        if (deliveryError) throw deliveryError;
      } catch (error) {
        logger.error({ error, item }, "Lỗi khi lưu tin vào schema v2");
        if (item.is_international) {
          const databaseError = error as {
            code?: string;
            message?: string;
            details?: string;
            hint?: string;
          };
          writeInternationalNewsLog("DATABASE_INSERT_FAILED", {
            source: item.source,
            table: "articles",
            title: item.title,
            publishedAt: item.published_at,
            code: databaseError.code,
            message:
              databaseError.message ||
              (error instanceof Error ? error.message : String(error)),
            details: databaseError.details,
            hint: databaseError.hint,
          });
        }
        throw error;
      }
    }

    logger.info(
      `Đã xử lý ${newsItems.length} tin trong schema v2 ` +
        `(inserted=${inserted}, duplicates=${duplicates})`
    );
    return { inserted, duplicates };
  }

  async getUnsentNews(windowHours: number): Promise<StockNews[]> {
    const channelId = await this.getDefaultChannelId();
    const { data, error } = await this.client
      .from("article_deliveries")
      .select(`
        article_id,
        status,
        article:articles!inner(
          id,
          original_title,
          translated_title,
          display_title,
          summary,
          canonical_url,
          region,
          original_language,
          published_at,
          created_at,
          status,
          source:news_sources!inner(id,name),
          stocks:article_stocks(stock_symbol)
        )
      `)
      .eq("channel_id", channelId)
      .in("status", ["pending", "failed"])
      .eq("article.status", "published")
      .limit(1000);

    if (error) {
      logger.error({ error }, "Lỗi khi lấy tin chưa gửi từ schema v2");
      throw error;
    }

    const domesticSince = Date.now() - windowHours * 60 * 60 * 1000;
    return (data || [])
      .map((row) => this.mapArticle(row))
      .filter((item) => {
        if (item.is_international) return true;
        if (!item.published_at) return false;
        return new Date(item.published_at).getTime() >= domesticSince;
      })
      .sort(this.sortByPublishedAt);
  }

  async getNewsForTesting(windowHours: number): Promise<StockNews[]> {
    const { data, error } = await this.client
      .from("articles")
      .select(`
        id,
        original_title,
        translated_title,
        display_title,
        summary,
        canonical_url,
        region,
        original_language,
        published_at,
        created_at,
        status,
        source:news_sources!inner(id,name),
        stocks:article_stocks(stock_symbol)
      `)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(500);

    if (error) {
      logger.error({ error }, "Lỗi khi lấy tin test từ schema v2");
      throw error;
    }

    const domesticSince = Date.now() - windowHours * 60 * 60 * 1000;
    const configuredInternationalWindow = Number.parseInt(
      process.env.INTERNATIONAL_NEWS_WINDOW_HOURS || "72",
      10
    );
    const internationalHours = Number.isFinite(configuredInternationalWindow)
      ? Math.max(windowHours, configuredInternationalWindow)
      : Math.max(windowHours, 72);
    const internationalSince =
      Date.now() - internationalHours * 60 * 60 * 1000;

    return (data || [])
      .map((article) => this.mapArticle({ article, status: "pending" }))
      .filter((item) => {
        if (!item.published_at) return false;
        const publishedAt = new Date(item.published_at).getTime();
        return item.is_international
          ? publishedAt >= internationalSince
          : publishedAt >= domesticSince;
      })
      .sort(this.sortByPublishedAt);
  }

  async markAsSent(articleIds: string[]): Promise<void> {
    if (articleIds.length === 0) return;

    const channelId = await this.getDefaultChannelId();
    const now = new Date().toISOString();
    const { error } = await this.client
      .from("article_deliveries")
      .update({
        status: "sent",
        sent_at: now,
        error_message: null,
        updated_at: now,
      })
      .eq("channel_id", channelId)
      .in("article_id", articleIds);

    if (error) {
      logger.error({ error }, "Lỗi khi đánh dấu delivery đã gửi");
      throw error;
    }
  }

  async markSourcesFetched(sourceIds: string[]): Promise<void> {
    if (sourceIds.length === 0) return;

    const now = new Date().toISOString();
    const { error } = await this.client
      .from("news_sources")
      .update({ last_fetched_at: now, updated_at: now })
      .in("id", sourceIds);

    if (error) {
      logger.warn({ error }, "Không thể cập nhật last_fetched_at");
    }
  }

  async startCrawlRun(
    triggerType: "schedule" | "manual" | "test"
  ): Promise<string> {
    const { data, error } = await this.client
      .from("crawl_runs")
      .insert({ trigger_type: triggerType, status: "running" })
      .select("id")
      .single();

    if (error) throw error;
    return data.id as string;
  }

  async completeCrawlRun(
    crawlRunId: string,
    stats: { found: number; inserted: number; duplicates: number }
  ): Promise<void> {
    const { error } = await this.client
      .from("crawl_runs")
      .update({
        status: "success",
        items_found: stats.found,
        items_inserted: stats.inserted,
        items_duplicated: stats.duplicates,
        completed_at: new Date().toISOString(),
      })
      .eq("id", crawlRunId);

    if (error) throw error;
  }

  async failCrawlRun(crawlRunId: string, error: unknown): Promise<void> {
    const { error: updateError } = await this.client
      .from("crawl_runs")
      .update({
        status: "failed",
        error_count: 1,
        error_message:
          error instanceof Error ? error.message : String(error),
        completed_at: new Date().toISOString(),
      })
      .eq("id", crawlRunId);

    if (updateError) {
      logger.warn({ error: updateError }, "Không thể ghi crawl run thất bại");
    }
  }

  async getTrackedStocks(): Promise<TrackedStock[]> {
    const { data, error } = await this.client
      .from("tracked_stocks")
      .select("*")
      .eq("is_active", true);

    if (error) throw error;
    return data || [];
  }

  async addTrackedStock(symbol: string, name?: string): Promise<void> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!STOCK_SYMBOL_PATTERN.test(normalizedSymbol)) return;

    const { error } = await this.client.from("tracked_stocks").upsert(
      {
        symbol: normalizedSymbol,
        name: name || normalizedSymbol,
        is_active: true,
      },
      { onConflict: "symbol" }
    );

    if (error) throw error;
  }

  private async getDefaultChannelId(): Promise<string> {
    if (this.defaultChannelId) return this.defaultChannelId;

    const { data, error } = await this.client
      .from("delivery_channels")
      .select("id")
      .eq("code", DEFAULT_CHANNEL_CODE)
      .eq("is_active", true)
      .single();

    if (error) {
      logger.error(
        { error, channelCode: DEFAULT_CHANNEL_CODE },
        "Không tìm thấy kênh Telegram mặc định"
      );
      throw error;
    }

    this.defaultChannelId = data.id as string;
    return this.defaultChannelId;
  }

  private extractSymbols(value: string): string[] {
    if (!value) return [];
    return [
      ...new Set(
        value
          .toUpperCase()
          .split(/[\/,;\s]+/)
          .map((symbol) => symbol.trim())
          .filter((symbol) => STOCK_SYMBOL_PATTERN.test(symbol))
      ),
    ];
  }

  private mapArticle(row: any): StockNews {
    const article = Array.isArray(row.article) ? row.article[0] : row.article;
    const source = Array.isArray(article.source)
      ? article.source[0]
      : article.source;
    const stocks = Array.isArray(article.stocks) ? article.stocks : [];
    const symbols = stocks
      .map((item: { stock_symbol?: string }) => item.stock_symbol)
      .filter((symbol: string | undefined): symbol is string => Boolean(symbol))
      .sort();

    return {
      id: article.id,
      source_id: source?.id,
      stock_symbol: symbols.join("/") || "GENERAL",
      title:
        article.display_title ||
        article.translated_title ||
        article.original_title,
      is_international: article.region === "international",
      original_language: article.original_language,
      source: source?.name || "Unknown",
      url: article.canonical_url || undefined,
      summary: article.summary || undefined,
      published_at: article.published_at || undefined,
      is_sent: row.status === "sent",
      created_at: article.created_at,
    };
  }

  private sortByPublishedAt(a: StockNews, b: StockNews): number {
    const aTime = a.published_at ? new Date(a.published_at).getTime() : 0;
    const bTime = b.published_at ? new Date(b.published_at).getTime() : 0;
    return bTime - aTime;
  }
}
