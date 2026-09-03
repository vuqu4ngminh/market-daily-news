import dotenv from "dotenv";
import type { Config } from "../types/index.js";

dotenv.config();

export type RunMode = "LIVE" | "TEST";

/**
 * GitHub determines the mode without requiring an extra Secret or Variable:
 * schedule -> LIVE, workflow_dispatch -> TEST. RUN_MODE is only a local fallback.
 */
export function resolveRunMode(
  environment: NodeJS.ProcessEnv = process.env
): RunMode {
  if (environment.GITHUB_EVENT_NAME === "schedule") return "LIVE";
  if (environment.GITHUB_EVENT_NAME === "workflow_dispatch") return "TEST";

  const configuredMode = String(environment.RUN_MODE || "LIVE")
    .trim()
    .toUpperCase();

  if (configuredMode !== "LIVE" && configuredMode !== "TEST") {
    throw new Error("RUN_MODE chỉ nhận giá trị TEST hoặc LIVE");
  }

  return configuredMode;
}

function validateEnv(): void {
  const requiredVars = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TELEGRAM_TOKEN",
    "TELEGRAM_CHAT_ID",
  ];

  const missing = requiredVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    throw new Error(
      `Thiếu biến môi trường bắt buộc: ${missing.join(", ")}`
    );
  }
}

export function getConfig(): Config {
  validateEnv();

  const symbolsEnv = process.env.STOCK_SYMBOLS;
  const defaultSymbols = [
    "VCB", "VNM", "FPT", "HPG", "GAS", "MSN", "VHM",
    "TCB", "MWG", "SSI", "VIC", "GVR", "PLX", "BID",
    "CTG", "VPB", "STB", "HDB", "MBB", "ACB",
  ];

  return {
    supabase: {
      url: process.env.SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    },
    telegram: {
      token: process.env.TELEGRAM_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID!,
    },
    stockSymbols: symbolsEnv
      ? symbolsEnv.split(",").map((s) => s.trim().toUpperCase())
      : defaultSymbols,
    newsWindowHours: parseInt(process.env.NEWS_WINDOW_HOURS || "3", 10),
    logLevel: process.env.LOG_LEVEL || "info",
  };
}

export default getConfig;
