import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "./logger.js";

const LOG_DIRECTORY = resolve("logs");
const LOG_FILE = resolve(LOG_DIRECTORY, "international-news.log");

export function writeInternationalNewsLog(
  event: string,
  details: Record<string, unknown>
): void {
  try {
    mkdirSync(LOG_DIRECTORY, { recursive: true });
    appendFileSync(
      LOG_FILE,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        ...details,
      })}\n`,
      "utf8"
    );
  } catch (error) {
    logger.warn(
      { error },
      "Không thể ghi logs/international-news.log"
    );
  }
}

