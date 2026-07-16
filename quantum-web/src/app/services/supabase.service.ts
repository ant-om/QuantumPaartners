import { Inject, Injectable, PLATFORM_ID, PendingTasks, TransferState, makeStateKey } from '@angular/core';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
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

// ── Round-4 Q&A chains (raw_output JSONB, fetched lazily per factor) ──
export interface FactorChainStep { label: string; text: string; }
export interface FactorChain { qa: FactorChainStep[]; conclusion: string | null; raw: string | null; }

/** raw_output module keys we are allowed to JSON-path select. Never build the
 *  select string from unvalidated route input. */
const RAW_OUTPUT_MODULES = ['political', 'price', 'macro', 'management', 'sentiment', 'competition', 'fs'] as const;
export type RawOutputModule = typeof RAW_OUTPUT_MODULES[number];

/** Defensive parser for one module's Q&A chains. Live shape (captured 2026-07-16):
 *  { chain_1: "...", ..., chain_6: "..." } — plain text, usually prefixed with a
 *  "[Module | TICKER | date | Layer 2 | Q&A Chain N]" header line; the last chain
 *  is the module's synthesis/conclusion. Anything unexpected falls back to raw text. */
export function parseFactorChain(moduleData: unknown): FactorChain | null {
  if (moduleData === null || moduleData === undefined) return null;

  if (typeof moduleData === 'string') {
    return moduleData.trim() ? { qa: [], conclusion: null, raw: moduleData.trim() } : null;
  }
  if (typeof moduleData !== 'object') return null;

  const entries = Object.entries(moduleData as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' && (v as string).trim().length > 0)
    .map(([k, v]) => {
      const m = /^chain[_ ]?(\d+)$/i.exec(k);
      return { order: m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER, key: k, text: (v as string).trim() };
    })
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

  if (!entries.length) return null;

  const steps: FactorChainStep[] = entries.map((e, i) => {
    let text = e.text;
    let label = `Question ${i + 1}`;
    // Strip the bracketed provenance header if present, keep it as the label
    const header = /^\[([^\]\n]{1,120})\]\s*\n+/.exec(text);
    if (header) {
      label = header[1].trim();
      text = text.slice(header[0].length).trim();
    }
    return { label, text };
  });

  if (steps.length === 1) return { qa: [], conclusion: steps[0].text, raw: null };
  const conclusion = steps[steps.length - 1];
  return { qa: steps.slice(0, -1), conclusion: conclusion.text, raw: null };
}

export interface ScoreHistoryPoint {
  run_at: string;
  summary_score: number | null;
  [factorKey: string]: string | number | null;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private client: SupabaseClient;
  private readonly isServer: boolean;
  private readonly isBrowser: boolean;

  constructor(
    private transferState: TransferState,
    private pendingTasks: PendingTasks,
    @Inject(PLATFORM_ID) platformId: object,
  ) {
    this.isServer = isPlatformServer(platformId);
    this.isBrowser = isPlatformBrowser(platformId);
    // Anonymous reads only — disable GoTrue session machinery. Its timers and
    // storage/lock access keep Angular's zone unstable during SSR (renders hang).
    this.client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  /** Shared anon client for sibling services (e.g. NewsletterService). */
  get supabase(): SupabaseClient {
    return this.client;
  }

  /** SSR → hydration handoff: the server stores each read in TransferState so
   *  the browser's first render reuses it instead of re-querying Supabase.
   *  PendingTasks holds SSR stability open during the fetch — supabase-js uses
   *  Node's native fetch, which zone.js cannot track (renders would race). */
  private async cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const stateKey = makeStateKey<T>(`sb:${key}`);
    if (this.isBrowser && this.transferState.hasKey(stateKey)) {
      const value = this.transferState.get(stateKey, null as T);
      this.transferState.remove(stateKey); // later navigations fetch fresh
      return value;
    }
    const done = this.pendingTasks.add();
    try {
      const value = await fetcher();
      if (this.isServer) this.transferState.set(stateKey, value);
      return value;
    } finally {
      done();
    }
  }

  async getStocks(): Promise<Stock[]> {
    return this.cached('stocks', async () => {
      const { data, error } = await this.client
        .from('stocks')
        .select('id, ticker, name, exchange, sector, industry, country, description, website, logo_url')
        .order('ticker');
      if (error) throw error;
      return data as Stock[];
    });
  }

  async getStockByTicker(ticker: string): Promise<Stock | null> {
    return this.cached(`stock:${ticker.toUpperCase()}`, async () => {
      const { data, error } = await this.client
        .from('stocks')
        .select('*')
        .eq('ticker', ticker.toUpperCase())
        .single();
      if (error) return null;
      return data as Stock;
    });
  }

  async getAnalysis(stockId: string): Promise<StockAnalysis | null> {
    return this.cached(`analysis:${stockId}`, async () => {
      const { data, error } = await this.client
        .from('stock_analyses')
        .select('id, stock_id, source, run_at, summary, political, price, macro, management, sentiment, competitor, financial, metrics')
        .eq('stock_id', stockId)
        .single();
      if (error) return null;
      return data as StockAnalysis;
    });
  }

  /** Lazily fetch ONE module's round-4 Q&A chains from raw_output.
   *  moduleKey is validated against a whitelist — never interpolated from raw input. */
  async getFactorChain(stockId: string, moduleKey: string): Promise<FactorChain | null> {
    if (!(RAW_OUTPUT_MODULES as readonly string[]).includes(moduleKey)) return null;
    return this.cached(`chain:${stockId}:${moduleKey}`, async () => {
      const { data, error } = await this.client
        .from('stock_analyses')
        .select(`chain:raw_output->${moduleKey}`)
        .eq('stock_id', stockId)
        .single();
      if (error) return null;
      return parseFactorChain((data as { chain?: unknown } | null)?.chain);
    });
  }

  /** Score evolution over runs. Backed by the analysis_score_history SQL view
   *  (doc/sql/analysis_score_history.sql) — returns [] until the view exists. */
  async getScoreHistory(stockId: string): Promise<ScoreHistoryPoint[]> {
    try {
      return await this.cached(`history:${stockId}`, async () => {
        const { data, error } = await this.client
          .from('analysis_score_history')
          .select('*')
          .eq('stock_id', stockId)
          .order('run_at');
        if (error || !data) return [];
        return data as ScoreHistoryPoint[];
      });
    } catch {
      return [];
    }
  }
}
