import axios from "axios";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { StockNews } from "../types/index.js";
import { writeInternationalNewsLog } from "../utils/internationalNewsLog.js";
import { logger } from "../utils/logger.js";

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
}

interface RssFeed {
  rss?: {
    channel?: {
      item?: RssItem | RssItem[];
    };
  };
}

interface RssSource {
  name: string;
  url: string;
  language: "vi" | "en";
  detectTickerPrefix: boolean;
}

const RSS_SOURCES: RssSource[] = [
  {
    name: "StockBiz",
    url: "https://web.stockbiz.vn/RSS/News/All.ashx",
    language: "vi",
    detectTickerPrefix: true,
  },
  {
    name: "Yahoo Finance",
    url: "https://finance.yahoo.com/news/rss",
    language: "en",
    detectTickerPrefix: false,
  },
];

/**
 * Parse pubDate về ISO string
 */
function parseDate(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/**
 * Clean HTML tags từ description
 */
function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 500);
}

function normalizeUrl(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value.trim());
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach(
      (name) => url.searchParams.delete(name)
    );
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return value.trim();
  }
}

function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function createDedupeKey(title: string): string {
  return createHash("sha256").update(normalizeTitle(title)).digest("hex");
}

export async function scrapeNews(
  windowHours = 5
): Promise<StockNews[]> {
  const configuredInternationalWindow = Number.parseInt(
    process.env.INTERNATIONAL_NEWS_WINDOW_HOURS || "72",
    10
  );
  const internationalWindowHours = Number.isFinite(configuredInternationalWindow)
    ? Math.max(windowHours, configuredInternationalWindow)
    : Math.max(windowHours, 72);
  const allNews: StockNews[] = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
  });

  for (const source of RSS_SOURCES) {
    const isInternational = source.language !== "vi";
    const sourceWindowHours = isInternational
      ? internationalWindowHours
      : windowHours;
    const sourceStats = {
      totalItems: 0,
      acceptedItems: 0,
      outsideWindowItems: 0,
      missingTitleItems: 0,
      invalidDateItems: 0,
    };
    const outsideWindowSamples: Array<{
      title?: string;
      pubDate?: string;
      hoursAgo?: number;
    }> = [];

    try {
      logger.info(`Đang crawl: ${source.name}`);

      if (isInternational) {
        writeInternationalNewsLog("FETCH_STARTED", {
          source: source.name,
          url: source.url,
          windowHours: sourceWindowHours,
        });
      }

      const response = await axios.get(source.url, {
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; MarketDailyNews/2.0; +https://github.com/vuqu4ngminh/market-daily-news)",
          Accept:
            "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        },
        responseType: "text",
      });

      if (isInternational) {
        writeInternationalNewsLog("HTTP_SUCCESS", {
          source: source.name,
          status: response.status,
          contentType: response.headers["content-type"],
          responseBytes:
            typeof response.data === "string" ? response.data.length : undefined,
        });
      }

      const parsed: RssFeed = parser.parse(response.data);
      const items = parsed.rss?.channel?.item;
      if (!items) {
        if (isInternational) {
          writeInternationalNewsLog("RSS_ITEMS_MISSING", {
            source: source.name,
            message: "Không tìm thấy rss.channel.item trong phản hồi.",
          });
        }
        continue;
      }

      const itemArray = Array.isArray(items) ? items : [items];
      sourceStats.totalItems = itemArray.length;

      for (const item of itemArray) {
        const title = item.title?.trim();
        if (!title) {
          sourceStats.missingTitleItems++;
          continue;
        }

        const description = item.description
          ? cleanHtml(item.description)
          : undefined;

        const pubDate = parseDate(item.pubDate);
        if (!pubDate) {
          sourceStats.invalidDateItems++;
          continue;
        }

        const hoursAgo =
          (Date.now() - new Date(pubDate).getTime()) / (1000 * 60 * 60);
        if (hoursAgo > sourceWindowHours) {
          sourceStats.outsideWindowItems++;
          if (outsideWindowSamples.length < 5) {
            outsideWindowSamples.push({
              title,
              pubDate,
              hoursAgo: Number(hoursAgo.toFixed(2)),
            });
          }
          continue;
        }

        const url = normalizeUrl(item.link);

        // Nếu title có dạng "XXX: rest of title" thì lấy 3 chữ cái trước dấu ':' làm symbol
        // Nếu không khớp, để là GENERAL
        let symbol = "GENERAL";
        let parsedTitle = title;
        const m = source.detectTickerPrefix
          ? title.match(/^([A-Za-z]{3})\s*[:\-]\s*(.+)$/)
          : null;
        if (m) {
          symbol = m[1].toUpperCase();
          parsedTitle = m[2].trim();
        }

        allNews.push({
          stock_symbol: symbol,
          title: parsedTitle,
          dedupe_key: createDedupeKey(parsedTitle),
          is_international: isInternational,
          original_language: source.language,
          source: source.name,
          url,
          summary: description,
          published_at: pubDate,
          is_sent: false,
        });
        sourceStats.acceptedItems++;
      }

      if (isInternational) {
        writeInternationalNewsLog("RSS_PROCESSED", {
          source: source.name,
          windowHours: sourceWindowHours,
          ...sourceStats,
          outsideWindowSamples,
          message:
            sourceStats.acceptedItems === 0
              ? "Nguồn phản hồi thành công nhưng không có tin nằm trong cửa sổ thời gian."
              : "Đã đọc được tin quốc tế hợp lệ.",
        });
      }

      logger.info(
        `${source.name}: tìm thấy ${itemArray.length} tin, lọc trong ${sourceWindowHours} giờ`
      );
    } catch (error) {
      if (isInternational) {
        const axiosError = axios.isAxiosError(error) ? error : undefined;
        const responseBody = axiosError?.response?.data;

        writeInternationalNewsLog("FETCH_FAILED", {
          source: source.name,
          url: source.url,
          message: error instanceof Error ? error.message : String(error),
          code: axiosError?.code,
          status: axiosError?.response?.status,
          statusText: axiosError?.response?.statusText,
          responseBody:
            typeof responseBody === "string"
              ? responseBody.substring(0, 1000)
              : responseBody,
          stats: sourceStats,
        });
      }

      logger.warn(
        { error: (error as Error).message },
        `Không thể crawl ${source.name}`
      );
    }
  }

  const seen = new Set<string>();
  const uniqueNews = allNews.filter((n) => {
    const key = createDedupeKey(n.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logger.info(`Tổng cộng ${uniqueNews.length} tin tức liên quan sau khi lọc`);
  return uniqueNews;
}
