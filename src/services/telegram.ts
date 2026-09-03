import axios from "axios";
import { writeInternationalNewsLog } from "../utils/internationalNewsLog.js";
import { logger } from "../utils/logger.js";

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  message: string
): Promise<void> {
  const containsInternationalNews = message.includes("Yahoo Finance");

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    if (containsInternationalNews) {
      writeInternationalNewsLog("TELEGRAM_SEND_STARTED", {
        messageLength: message.length,
        messagePreview: message.substring(0, 500),
      });
    }

    const response = await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    if (containsInternationalNews) {
      writeInternationalNewsLog("TELEGRAM_SEND_SUCCESS", {
        status: response.status,
        messageLength: message.length,
      });
    }

    logger.info("✅ Đã gửi tin nhắn Telegram thành công");
  } catch (error) {
    if (containsInternationalNews) {
      const axiosError = axios.isAxiosError(error) ? error : undefined;
      writeInternationalNewsLog("TELEGRAM_SEND_FAILED", {
        message: error instanceof Error ? error.message : String(error),
        code: axiosError?.code,
        status: axiosError?.response?.status,
        responseBody: axiosError?.response?.data,
        messageLength: message.length,
        messagePreview: message.substring(0, 1000),
      });
    }

    logger.error(
      { error: (error as Error).message },
      "❌ Gửi Telegram thất bại"
    );
    throw error;
  }
}

/**
 * Định dạng tin tức thành HTML an toàn cho Telegram.
 * HTML chỉ cần escape các ký tự cấu trúc nên không làm xuất hiện dấu "\\"
 * trước ngoặc tròn hoặc các dấu câu thường gặp trong tiêu đề Việt/Anh.
 */
export function formatNewsMessage(
  newsItems: Array<{
    title: string;
    stock_symbol: string;
    source: string;
    source_group?: string;
    source_order?: number;
    url?: string;
    published_at?: string;
  }>
): string[] {
  const now = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const sortedItems = newsItems
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => {
      const orderDifference =
        (a.item.source_order ?? 100) - (b.item.source_order ?? 100);
      if (orderDifference !== 0) return orderDifference;

      const aGroup = a.item.source_group || a.item.source;
      const bGroup = b.item.source_group || b.item.source;
      const groupDifference = aGroup.localeCompare(bGroup, "vi");
      if (groupDifference !== 0) return groupDifference;

      const aTime = a.item.published_at
        ? new Date(a.item.published_at).getTime()
        : 0;
      const bTime = b.item.published_at
        ? new Date(b.item.published_at).getTime()
        : 0;
      return bTime - aTime || a.originalIndex - b.originalIndex;
    });

  const entries = sortedItems.map(({ item }, index) => {
    const timeStr = item.published_at
      ? new Date(item.published_at).toLocaleTimeString("vi-VN", {
          timeZone: "UTC",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    const symbol = /^[A-Z]{3}(?:\/[A-Z]{3})*$/.test(item.stock_symbol)
      ? `${item.stock_symbol}: `
      : "";
    const title = escapeHtml(`${symbol}${item.title}`);
    const link = item.url || "";
    const source = escapeHtml(item.source);

    let line = `${index + 1}. ${title}`;
    if (timeStr) {
      line += ` <i>(${timeStr})</i>`;
    }
    if (source) {
      line += link
        ? ` <a href="${escapeHtml(link)}">[${source}]</a>`
        : ` [${source}]`;
    }

    return {
      group: item.source_group || item.source || "Khác",
      line,
    };
  });

  const header = `<b>TIN TỨC MỚI - ${escapeHtml(now)}</b>`;
  const maxMessageLength = 3800;
  const messages: string[] = [];
  let current = `${header}\n\n`;
  let currentGroup = "";
  let hasEntries = false;

  for (const entry of entries) {
    const escapedGroup = escapeHtml(entry.group);
    const groupChanged = currentGroup !== entry.group;
    const next = groupChanged
      ? `${hasEntries ? "\n\n" : ""}<b>${escapedGroup}</b>\n${entry.line}`
      : `\n${entry.line}`;

    if (current.length + next.length > maxMessageLength && hasEntries) {
      messages.push(current.trim());
      current = `${header}\n\n<b>${escapedGroup}</b>\n${entry.line}`;
      currentGroup = entry.group;
      hasEntries = true;
    } else {
      current += next;
      currentGroup = entry.group;
      hasEntries = true;
    }
  }

  if (hasEntries) messages.push(current.trim());
  return messages;
}

/**
 * Escape nội dung động trước khi chèn vào Telegram HTML.
 * Regex hoạt động trên ký tự cấu trúc HTML và không phụ thuộc ngôn ngữ.
*/
function escapeHtml(text: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return text.replace(/[&<>"']/g, (character) => entities[character]);
}
