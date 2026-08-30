export interface StockNews {
  id?: string;
  stock_symbol: string;
  title: string;
  dedupe_key?: string;
  is_international?: boolean;
  original_language?: string;
  source: string;
  url?: string;
  summary?: string;
  published_at?: string;
  sent_at?: string;
  is_sent?: boolean;
  created_at?: string;
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
