export interface StockNews {
  id?: string;
  source_id?: string;
  stock_symbol: string;
  title: string;
  dedupe_key?: string;
  is_international?: boolean;
  original_language?: string;
  source: string;
  source_group?: string;
  source_order?: number;
  url?: string;
  summary?: string;
  published_at?: string;
  sent_at?: string;
  is_sent?: boolean;
  created_at?: string;
}

export interface NewsSource {
  id: string;
  code: string;
  name: string;
  source_type: "rss" | "api" | "scraper";
  feed_url: string;
  website_url?: string;
  country_code?: string;
  language_code: string;
  is_international: boolean;
  is_active: boolean;
  display_order: number;
  telegram_group?: string;
  fetch_interval_minutes: number;
  parser_config?: {
    detectTickerPrefix?: boolean;
    [key: string]: unknown;
  };
  last_fetched_at?: string;
}

export interface TrackedStock {
  symbol: string;
  name?: string;
  is_active?: boolean;
  created_at?: string;
}

export interface Config {
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  telegram: {
    token: string;
    chatId: string;
  };
  stockSymbols: string[];
  newsWindowHours: number;
  logLevel: string;
}
