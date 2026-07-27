import axios from "axios";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { StockNews } from "../types/index.js";
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

const RSS_SOURCES = [
  {
    name: "StockBiz",
    url: "https://web.stockbiz.vn/RSS/News/All.ashx",
  }
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
  const allNews: StockNews[] = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
  });

  for (const source of RSS_SOURCES) {
    try {
      logger.info(`Đang crawl: ${source.name}`);

      const response = await axios.get(source.url, {
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0",
        },
        responseType: "text",
      });

      const parsed: RssFeed = parser.parse(response.data);
      const items = parsed.rss?.channel?.item;
      if (!items) continue;

      const itemArray = Array.isArray(items) ? items : [items];

      for (const item of itemArray) {
        const title = item.title?.trim();
        if (!title) continue;

        const description = item.description
          ? cleanHtml(item.description)
          : undefined;

        const pubDate = parseDate(item.pubDate);
        if (!pubDate) continue;

        const hoursAgo =
          (Date.now() - new Date(pubDate).getTime()) / (1000 * 60 * 60);
        if (hoursAgo > windowHours) continue;

        const url = normalizeUrl(item.link);

        // Nếu title có dạng "XXX: rest of title" thì lấy 3 chữ cái trước dấu ':' làm symbol
        // Nếu không khớp, để là GENERAL
        let symbol = "GENERAL";
        let parsedTitle = title;
        const m = title.match(/^([A-Za-z]{3})\s*[:\-]\s*(.+)$/);
        if (m) {
          symbol = m[1].toUpperCase();
          parsedTitle = m[2].trim();
        }

        allNews.push({
          stock_symbol: symbol,
          title: parsedTitle,
          dedupe_key: createDedupeKey(parsedTitle),
          source: source.name,
          url,
          summary: description,
          published_at: pubDate,
          is_sent: false,
        });
      }

      logger.info(
        `${source.name}: tìm thấy ${itemArray.length} tin, lọc được tin mới trong ${windowHours} giờ`
      );
    } catch (error) {
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
