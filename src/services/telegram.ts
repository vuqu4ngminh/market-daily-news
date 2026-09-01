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

  const lines = newsItems.map((item, index) => {
    const timeStr = item.published_at
      ? new Date(item.published_at).toLocaleTimeString("vi-VN", {
          timeZone: "UTC",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    const symbol = /^[A-Z]{3}$/.test(item.stock_symbol)
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

    return line;
  });

  const header = `<b>TIN TỨC MỚI - ${escapeHtml(now)}</b>`;
  const maxMessageLength = 3800;
  const messages: string[] = [];
  let current = `${header}\n\n`;

  for (const line of lines) {
    const next = current.endsWith("\n\n") ? line : `\n${line}`;
    if (current.length + next.length > maxMessageLength && current !== `${header}\n\n`) {
      messages.push(current.trim());
      current = `${header}\n\n${line}`;
    } else {
      current += next;
    }
  }

  if (current.trim() !== header) messages.push(current.trim());
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
