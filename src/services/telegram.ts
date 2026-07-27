import axios from "axios";
import { logger } from "../utils/logger.js";

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  message: string
): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    });

    logger.info("✅ Đã gửi tin nhắn Telegram thành công");
  } catch (error) {
    logger.error(
      { error: (error as Error).message },
      "❌ Gửi Telegram thất bại"
    );
    throw error;
  }
}

/**
 * Định dạng tin tức thành tin nhắn Markdown cho Telegram
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
          // StockBiz publishes pubDate in GMT. Keep the source's hh:mm instead
          // of converting it to Vietnam time before displaying it.
          timeZone: "UTC",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    const symbol = /^[A-Z]{3}$/.test(item.stock_symbol)
      ? `${item.stock_symbol}: `
      : "";
    const title = escapeMarkdown(`${symbol}${item.title}`);
    const link = item.url || "";
    const source = escapeMarkdown(item.source);

    let line = `${index + 1}. ${title}`;
    if (timeStr) {
      line += ` _(${timeStr})_`;
    }
    if (source) {
      line += link ? ` [${source}](${link})` : ` [${source}]`;
    }

    return line;
  });

  const header = `*TIN TỨC MỚI - ${now}*`;
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
* Escape ký tự đặc biệt trong Markdown v1 của Telegram
*/
function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/~/g, "\\~")
    .replace(/`/g, "\\`")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/-/g, "\\-")
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}
