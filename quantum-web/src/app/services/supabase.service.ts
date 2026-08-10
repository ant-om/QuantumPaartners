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
  certainty?: number; // 0-100, committee confidence — distinct from score (direction)
}

// ── R5 committee verdict (new structurer rows only — legacy rows lack it) ──
export type VerdictRecommendation = 'BUY' | 'HOLD' | 'SELL';
export type VerdictConviction = 'HIGH' | 'MEDIUM' | 'LOW';
export type HorizonStance = 'BULLISH' | 'NEUTRAL' | 'BEARISH';

export interface VerdictHorizon {
  stance: HorizonStance;
  rationale: string;
}

export interface AnalysisVerdict {
  recommendation: VerdictRecommendation;
  conviction: VerdictConviction;
  horizons?: {
    short?: VerdictHorizon;
    medium?: VerdictHorizon;
    long?: VerdictHorizon;
  };
}

export interface AnalysisSummary {
  headline: string;
  narrative: string;
  bullets?: string[];
  overall_sentiment?: Sentiment;
  /** Legacy numeric score; new R5-structurer rows may set this to null. */
  score?: number | null;
  /** New R5-structurer rows only. Feature-detect — absent on legacy rows. */
  verdict?: AnalysisVerdict;
}

/** One committee verdict per pipeline run, from the archive project's
 *  read-only verdict_history view (backed by r5_synthesis). */
export interface VerdictHistoryPoint {
  run_date: string;
  ticker: string;
  recommendation: VerdictRecommendation | null;
  conviction: VerdictConviction | null;
  short_term: HorizonStance | null;
  medium_term: HorizonStance | null;
  long_term: HorizonStance | null;
}

/** Display-side repair of structurer artifacts in `summary`: the DS R5
 *  structurer hard-cuts `headline` at 200 chars (mid-word) and can leak
 *  unpaired markdown `**` tokens from its Section-9 parse. When the headline
 *  is a truncated prefix of the narrative, promote the narrative's first full
 *  sentence to headline and drop it from the narrative so the page doesn't
 *  open with the same sentence twice. Legacy rows pass through untouched. */
export function cleanAnalysisSummary(summary: AnalysisSummary | null): AnalysisSummary | null {
  if (!summary) return summary;

  const strip = (t: string | undefined | null): string => (t ?? '')
    .replace(/^\s*\*{2,}\s*$/gm, '')   // paragraphs that are only asterisks
    .replace(/^\s*\*{2,}\s*/, '')      // unpaired leading **
    .replace(/\s*\*{2,}\s*$/, '')      // unpaired trailing **
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let headline = strip(summary.headline);
  let narrative = strip(summary.narrative);

  const truncated = headline.length >= 120 && !/[.!?…"”')\]]$/.test(headline);
  if (truncated) {
    // Sentence end = lowercase/digit/%/quote before .!? then whitespace —
    // skips abbreviations like "U.S." without a dictionary.
    const sentence = narrative.toLowerCase().startsWith(headline.slice(0, 80).toLowerCase())
      ? /^[\s\S]{40,420}?[a-z0-9%)"][.!?](?=\s|$)/.exec(narrative)
      : null;
    headline = sentence ? sentence[0].trim() : headline.replace(/\s+\S*$/, '') + '…';
  }
  if (headline && narrative.startsWith(headline)) {
    narrative = narrative.slice(headline.length).replace(/^[\s.\-–—]+/, '').trim();
  }

  return { ...summary, headline, narrative };
}

/** Display-side repair of structurer takeaways: the DS R5 structurer derives
 *  `takeaway` as the first sentence of the section's Projection but falls back
 *  to a hard 200-char cut (mid-word) whenever that sentence runs longer than
 *  220 chars. The full text is stored in `body`, so re-derive the complete
 *  first sentence with no cap; only if the section has no sentence end at all,
 *  cut on a word boundary with an ellipsis. Well-formed rows pass through
 *  untouched. */
export function cleanSectionBlocks(blocks: SectionBlock[] | null): SectionBlock[] | null {
  if (!blocks) return blocks;
  return blocks.map(b => {
    if (!b?.body || !b.takeaway) return b;
    const looksCut = b.takeaway.length >= 190 && !/[.!?…"”')\]]$/.test(b.takeaway.trim());
    if (!looksCut) return b;
    const t = b.body.replace(/[*#`_]+/g, '').replace(/^Projection:?\s*/i, '').trim();
    const m = t.match(/^([\s\S]{20,600}?[.!?…])(?=\s|$)/);
    const takeaway = (m ? m[1] : t.slice(0, 300).replace(/\s+\S*$/, '') + '…').trim();
    return { ...b, takeaway };
  });
}

/** Full Projection paragraph of a structurer section — the text between the
 *  "Projection" label and the next labelled part (Insight / scores / certainty).
 *  Null when the body doesn't follow the R5-structurer shape (legacy rows). */
export function sectionProjection(block: SectionBlock | null): string | null {
  if (!block?.body) return null;
  const t = block.body.replace(/[*#`_]+/g, '');
  const m = t.match(/^\s*Projection:?\s*([\s\S]*?)(?:\n\s*(?:Insight|Verbal Score|Projection Numeric|Certainty)\b|$)/i);
  const p = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return p.length >= 20 ? p : null;
}

/** Insight paragraphs of a structurer section, returned as raw markdown for
 *  the `md` pipe. Falls back to the whole body when the section has no
 *  Projection/Insight labelling at all (e.g. macro's scenario-list outlooks),
 *  so those rows still show their full content. Null when there is nothing
 *  beyond the Projection to show. */
export function sectionInsight(block: SectionBlock | null): string | null {
  if (!block?.body) return null;
  // Label forms in production: "**Insight**\n" (political/sentiment/fs),
  // "**Insight:**\n" (price/management), "**Insight:** same-line text" (macro/competitor)
  const m = block.body.match(/(?:^|\n)\s*\*{0,2}Insight:?\*{0,2}:?[ \t]*\n?([\s\S]*?)(?=\n\s*\*{0,2}(?:Verbal Score|Projection Numeric|Certainty)\b|$)/i);
  if (m) {
    const t = m[1].replace(/\n\s*-{3,}\s*$/, '').trim();
    return t.length >= 40 ? t : null;
  }
  if (!/\*{0,2}Projection\*{0,2}/i.test(block.body)) {
    const t = block.body.replace(/\n\s*-{3,}\s*$/, '').trim();
    return t.length >= 40 ? t : null;
  }
  return null;
}

/** The Certainty Explanation — why the committee is as sure as it is. Feeds
 *  the hover popover on the stance pill. Absent on Sentiment (its prompt
 *  never asks for one) and on legacy rows. */
export function sectionCertaintyText(block: SectionBlock | null): string | null {
  if (!block?.body) return null;
  const m = block.body.match(/\*{0,2}Certainty Explanation:?\*{0,2}:?[ \t]*\n?([\s\S]*?)(?=\n\s*\*{0,2}Certainty (?:Verbal|Numeric)\b|\n\s*-{3,}|$)/i);
  if (!m) return null;
  const t = m[1].replace(/[*#`_]+/g, '').replace(/\s+/g, ' ').trim();
  return t.length >= 10 ? t : null;
}

/** The strongest-version ("Evaluation") paragraphs of R5's bull and bear
 *  cases, extracted from the stored synthesis text by its own "### N." section
 *  headers. Feeds the "Committee view | The other side" toggle — under a
 *  directional verdict only the OPPOSITE case is shown (the aligned case IS
 *  the narrative). Null fields when the row has no R5 synthesis (legacy). */
export function r5CaseEvaluations(synthesis: string | null | undefined): { bull: string | null; bear: string | null } {
  if (!synthesis) return { bull: null, bear: null };
  const sections: Record<number, string> = {};
  const re = /^###\s*(\d+)\.[^\n]*\n/gm;
  let m: RegExpExecArray | null;
  let prev: { n: number; end: number } | null = null;
  while ((m = re.exec(synthesis))) {
    if (prev) sections[prev.n] = synthesis.slice(prev.end, m.index).trim();
    prev = { n: parseInt(m[1], 10), end: re.lastIndex };
  }
  if (prev) sections[prev.n] = synthesis.slice(prev.end).trim();
  const evalPara = (sec: string | undefined): string | null => {
    if (!sec) return null;
    const em = sec.match(/\*{0,2}Evaluation:?\*{0,2}:?\s*\n?([\s\S]+)$/i);
    const t = (em ? em[1] : '').trim();
    return t.length >= 60 ? t : null;
  };
  return { bull: evalPara(sections[6]), bear: evalPara(sections[7]) };
}

/** Chain numbers a section cites as its sources ("directly from Chains 2 and 5",
 *  "Chain‑1 refined analysis"). The committee writes these citations itself in
 *  each section's Certainty Explanation, so links built from them are
 *  data-grounded, never guessed. */
export function sectionChainRefs(block: SectionBlock | null): number[] {
  if (!block?.body) return [];
  const found = new Set<number>();
  const re = /\bchains?[\s‐-―-]*((?:\d+[\s,‐-―-]*(?:and\s+|&\s*)?)+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block.body))) {
    for (const d of m[1].match(/\d+/g) ?? []) {
      const n = parseInt(d, 10);
      if (n >= 1 && n <= 9) found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
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
  /** R5 synthesis text (verbatim) — present on ds_r5_structurer rows only. */
  r5_synthesis?: string | null;
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
 *  is the module's synthesis/conclusion. Chain count varies per module (e.g.
 *  management now has 6) — never assume a fixed N. Anything unexpected falls
 *  back to raw text. Keys starting with "_" (e.g. the new `_verbatim` sibling)
 *  are metadata, not chains — ignored. */
export function parseFactorChain(moduleData: unknown): FactorChain | null {
  if (moduleData === null || moduleData === undefined) return null;

  if (typeof moduleData === 'string') {
    return moduleData.trim() ? { qa: [], conclusion: null, raw: moduleData.trim() } : null;
  }
  if (typeof moduleData !== 'object') return null;

  const entries = Object.entries(moduleData as Record<string, unknown>)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && (v as string).trim().length > 0)
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
        .select('id, stock_id, source, run_at, summary, political, price, macro, management, sentiment, competitor, financial, metrics, r5_synthesis:raw_output->r5->>synthesis_verbatim')
        .eq('stock_id', stockId)
        .single();
      if (error) return null;
      const row = data as StockAnalysis;
      row.summary = cleanAnalysisSummary(row.summary);
      for (const key of ['political', 'price', 'macro', 'management', 'sentiment', 'competitor', 'financial'] as const) {
        row[key] = cleanSectionBlocks(row[key]);
      }
      return row;
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
  /** Verdict-per-run history from the committee archive (a separate Supabase
   *  project, public read-only view). Empty on any failure — never blocks render. */
  async getVerdictHistory(ticker: string): Promise<VerdictHistoryPoint[]> {
    try {
      return await this.cached(`verdicts:${ticker.toUpperCase()}`, async () => {
        const url = `${environment.archiveSupabaseUrl}/rest/v1/verdict_history` +
          `?ticker=eq.${encodeURIComponent(ticker.toUpperCase())}&order=run_date.asc`;
        const res = await fetch(url, { headers: {
          apikey: environment.archiveAnonKey,
          Authorization: `Bearer ${environment.archiveAnonKey}`,
        } });
        if (!res.ok) return [];
        return (await res.json()) as VerdictHistoryPoint[];
      });
    } catch {
      return [];
    }
  }

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
