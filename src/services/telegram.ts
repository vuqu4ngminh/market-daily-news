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
    source: string;
    url?: string;
    published_at?: string;
  }>
): string {
  const now = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const itemsToSend = newsItems.slice(0, 20);
  const lines = itemsToSend.map((item) => {
    const timeStr = item.published_at
      ? new Date(item.published_at).toLocaleTimeString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    const title = escapeMarkdown(item.title);
    const link = item.url || "";
    const source = escapeMarkdown(item.source);

    let line = `• ${link ? `[${title}](${link})` : title}`;
    if (timeStr) {
      line += ` _(⏰ ${timeStr})_`;
    }
    if (source) {
      line += ` _[${source}]_`;
    }

    return line;
  });

  let message = `📰 *TIN TỨC MỚI - ${now}*\n\n`;
  message += lines.join("\n");

  if (newsItems.length > itemsToSend.length) {
    message += `\n\n_... và ${newsItems.length - itemsToSend.length} tin khác_`;
  }

  return message.trim();
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
