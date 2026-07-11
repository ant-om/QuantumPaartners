import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export interface Stock {
  id: string;
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  country: string;
  description: string;
  website: string;
  logo_url: string;
}

// ── Structured analysis (v3 JSONB contract — see doc/data-model-v3.md) ──
export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface SectionBlock {
  heading: string;
  takeaway: string;
  body: string;
  bullets?: string[];
  sentiment?: Sentiment;
  score?: number; // 0-100
}

export interface AnalysisSummary {
  headline: string;
  narrative: string;
  bullets?: string[];
  overall_sentiment?: Sentiment;
  score?: number;
}

// Shape of the live Railway quant API (GET /analyze/<ticker>), stored as-is in `metrics`.
export interface PricePoint { date: string; close: number; }
export interface VixPoint { date: string; vix: number; }

export interface Metrics {
  ticker?: string;
  analysis_date?: string;
  sample?: { start: string; end: string };
  price?: { last_close: number; last_30d_close: PricePoint[]; };
  monte_carlo?: {
    horizon_days: number; n_simulations: number; mean_price: number;
    ci_95_lower: number; ci_95_upper: number;
    potential_return_pct: number; downside_risk_pct: number; upside_potential_pct: number;
  };
  returns?: {
    avg_daily_return: number; avg_monthly_return: number; daily_return_latest: number;
    sharpe_daily_annualized: number; sharpe_monthly_annualized: number; annualized_rf_from_ff: number;
  };
  volatility?: { annualized_volatility: number; garch11_last_cond_vol_ann: number; log_return_daily_std: number; };
  VaR?: { VaR_1pct_daily: number; VaR_5pct_daily: number; };
  drawdown?: { max_drawdown: number; calmar_ratio: number; peak_date: string; trough_date: string; };
  garch_model?: { model_type: string; persistence: number; parameters: { alpha: number; beta: number; omega: number; }; };
  factor_model?: {
    model: string; r_squared: number; adj_r_squared: number;
    capm_beta_univariate_60m: number; capm_alpha_univariate_annual: number;
    fama_french_alpha_annual: number; [k: string]: number | string;
  };
  technicals?: {
    SMA_20_last: number; SMA_50_last: number; SMA_200_last: number;
    EMA_50_last: number; EMA_200_last: number; EWM_20_last: number;
    RSI?: { RSI_14_last: number; RSI_14_state: string; RSI_14_last_5_sessions: number[];
            RSI_14_min_30d: number; RSI_14_max_30d: number; RSI_14_mean_30d: number; };
    MACD?: { macd_last: number; signal_last: number; histogram_last: number; crossover: string; };
    bollinger_bands?: { upper: number; middle: number; lower: number; pct_b: number; bandwidth: number; window: number; n_std: number; };
    golden_death_cross?: { current_state: string; last_cross_type: string; last_cross_date: string; days_since_last_cross: number; };
  };
  vix_levels?: { vix_level_last: number; vix_mean_30d: number; vix_min_30d: number; vix_max_30d: number; vix_pctile_in_sample: number; vix_last_30d: VixPoint[]; };
}

export interface StockAnalysis {
  id: string;
  stock_id: string;
  source: string;
  run_at: string;
  summary: AnalysisSummary | null;
  political: SectionBlock[] | null;
  price: SectionBlock[] | null;
  macro: SectionBlock[] | null;
  management: SectionBlock[] | null;
  sentiment: SectionBlock[] | null;
  competitor: SectionBlock[] | null;
  financial: SectionBlock[] | null;
  metrics: Metrics | null;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private client: SupabaseClient;

  constructor() {
    this.client = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
  }

  async getStocks(): Promise<Stock[]> {
    const { data, error } = await this.client
      .from('stocks')
      .select('id, ticker, name, exchange, sector, industry, country, description, website, logo_url')
      .order('ticker');
    if (error) throw error;
    return data as Stock[];
  }

  async getStockByTicker(ticker: string): Promise<Stock | null> {
    const { data, error } = await this.client
      .from('stocks')
      .select('*')
      .eq('ticker', ticker.toUpperCase())
      .single();
    if (error) return null;
    return data as Stock;
  }

  async getAnalysis(stockId: string): Promise<StockAnalysis | null> {
    const { data, error } = await this.client
      .from('stock_analyses')
      .select('id, stock_id, source, run_at, summary, political, price, macro, management, sentiment, competitor, financial, metrics')
      .eq('stock_id', stockId)
      .single();
    if (error) return null;
    return data as StockAnalysis;
  }
}
