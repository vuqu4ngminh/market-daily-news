import axios from "axios";
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
    name: "CafeF - Chứng khoán",
    url: "https://cafef.vn/thi-truong-chung-khoan.rss",
  },
  {
    name: "CafeF - Tài chính - Ngân hàng",
    url: "https://cafef.vn/tai-chinh-ngan-hang.rss",
  },
  {
    name: "CafeF - Bất động sản",
    url: "https://cafef.vn/bat-dong-san.rss",
  },
  {
    name: "CafeF - Doanh nghiệp",
    url: "https://cafef.vn/doanh-nghiep.rss",
  },
  {
    name: "VnExpress - Kinh doanh",
    url: "https://vnexpress.net/rss/kinh-doanh.rss",
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

export async function scrapeNews(
  windowHours = 1
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

        allNews.push({
          stock_symbol: "GENERAL",
          title,
          source: source.name,
          url: item.link,
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
    const key = `${n.title}|${n.stock_symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logger.info(`Tổng cộng ${uniqueNews.length} tin tức liên quan sau khi lọc`);
  return uniqueNews;
}
