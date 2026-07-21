/** Single source of truth for the 7 analysis factors.
 *  key    = column on stock_analyses (SectionBlock[])
 *  module = key inside raw_output (the n8n round-4 Q&A chains)
 *  slug   = URL segment for /stock/:ticker/:factor */
export interface FactorDef {
  key: 'political' | 'price' | 'macro' | 'management' | 'sentiment' | 'competitor' | 'financial';
  module: 'political' | 'price' | 'macro' | 'management' | 'sentiment' | 'competition' | 'fs';
  label: string;
  slug: string;
  short: string;
}

export const FACTORS: FactorDef[] = [
  { key: 'political',  module: 'political',   label: 'Political & Regulatory',    slug: 'political',  short: 'Political' },
  { key: 'price',      module: 'price',       label: 'Price Action',              slug: 'price',      short: 'Price' },
  { key: 'macro',      module: 'macro',       label: 'Macroeconomic Environment', slug: 'macro',      short: 'Macro' },
  { key: 'management', module: 'management',  label: 'Management & Governance',   slug: 'management', short: 'Management' },
  { key: 'sentiment',  module: 'sentiment',   label: 'Market Sentiment',          slug: 'sentiment',  short: 'Sentiment' },
  { key: 'competitor', module: 'competition', label: 'Competitive Landscape',     slug: 'competitor', short: 'Competition' },
  { key: 'financial',  module: 'fs',          label: 'Financial Health',          slug: 'financial',  short: 'Financials' },
];

/** Ordered chain-topic labels per raw_output module key (verified against the
 *  live L2 prompts). Used as step headings ONLY when the parsed chain count for
 *  a module exactly matches the list length — otherwise the generic
 *  "Question N" / provenance labels are kept (legacy rows, partial runs). */
export const CHAIN_TOPICS: Record<string, string[]> = {
  macro: [
    'International Macroeconomics',
    'US Monetary Policy & Government',
    'US Economic Data & Indicators',
    'Stock-Specific Macro Impact',
    'Scenario Development',
    'Conclusion',
  ],
  political: [
    'External Political Events & Institutions',
    'Internal Country-Specific Factors',
    'Political Theory Lenses',
    'Key Individuals & Non-State Actors',
    'Prediction Markets vs News Timeline',
    'Conclusion',
  ],
  fs: [
    'Revenue & Income Statement',
    'Balance Sheet',
    'Cash Flow Statement',
    'Key Financial Ratios',
    'Overlooked 10-K/10-Q Points',
    'Conclusion',
  ],
  competition: [
    'External Environment',
    'Porter\'s Five Forces',
    'Internal Capabilities',
    'Additional Insights',
    'Scenario Development',
    'Conclusion',
  ],
  management: [
    'Leadership & Strategy Execution',
    'Board Governance & Transparency',
    'Executive Compensation & Incentives',
    'Overlooked Material Points',
    'Scenario Development',
    'Conclusion',
  ],
  sentiment: [
    'Global Economy Sentiment',
    'Industry Sentiment',
    'Company-Specific Sentiment',
    'Integration & Final Analysis',
    'Scenario Development',
    'Conclusion',
  ],
  price: [
    'Moving Averages',
    'GARCH Volatility & VaR',
    'Fama-French & Risk-Adjusted Returns',
    'RSI',
    'Scenario Development',
    'Conclusion',
  ],
};

/** Term patterns for Wikipedia-style inline cross-links in rendered analysis
 *  text (MarkdownService). Keyed by the FACTORS slug (NOTE: the competition
 *  factor's slug is 'competitor', financial health's is 'financial').
 *  Rules enforced by the renderer: max ONE link per factor per rendered
 *  document (first occurrence wins), never link a factor page to itself.
 *  Patterns run against HTML-escaped text ('&' appears as '&amp;'). */
export interface FactorLinkTerm {
  slug: FactorDef['slug'] | string;
  patterns: RegExp[];
}

export const FACTOR_LINK_TERMS: FactorLinkTerm[] = [
  { slug: 'macro',      patterns: [/\b(macro(?:economic)?(?:\s+(?:environment|backdrop|conditions))?)\b/i] },
  { slug: 'political',  patterns: [
      /\b((?:political|policy|regulatory|geopolitical)\s+(?:landscape|environment|risk|factors|analysis))\b/i,
      /\bpolitical\b/i,
    ] },
  { slug: 'financial',  patterns: [/\b(financial\s+(?:statements?|health|position)|balance\s+sheet|income\s+statement|cash\s+flow|valuation\s+multiples?)\b/i] },
  { slug: 'competitor', patterns: [/\b(competiti(?:on|ve|tor)s?(?:\s+(?:position(?:ing)?|landscape|pressure))?)\b/i] },
  { slug: 'management', patterns: [/\b(management(?:\s+(?:quality|team|execution))?|governance|leadership)\b/i] },
  { slug: 'sentiment',  patterns: [/\b(sentiment|fear\s*(?:&(?:amp;)?|and)\s*greed|put[\/-]?call)\b/i] },
  { slug: 'price',      patterns: [
      /\b(technical(?:s|\s+analysis|\s+indicators)?|moving\s+averages?|monte\s+carlo|GARCH)\b/i,
      // Uppercase finance acronyms stay case-sensitive so prose "var" etc. never links
      /\b(RSI|MACD|VaR)\b/,
    ] },
];

export function factorBySlug(slug: string | null | undefined): FactorDef | null {
  if (!slug) return null;
  return FACTORS.find(f => f.slug === slug.toLowerCase()) ?? null;
}

export function prevNextFactor(slug: string): { prev: FactorDef; next: FactorDef } {
  const i = Math.max(0, FACTORS.findIndex(f => f.slug === slug));
  const n = FACTORS.length;
  return { prev: FACTORS[(i - 1 + n) % n], next: FACTORS[(i + 1) % n] };
}

// ── Direct-value display rule (user decision: scores come straight from the
// analysis blocks, NO client-side averaging) ────────────────────────────────
import { SectionBlock, Sentiment } from '../services/supabase.service';

export interface FactorDisplay {
  /** The factor's single score when the analysis provides one directly. */
  score: number | null;
  sentiment: Sentiment | undefined;
  takeaway: string | null;
  /** When no single score exists, the individual block scores (shown as-is). */
  blockScores: { heading: string; score: number }[];
}

const CONCLUSION_RE = /(conclusion|overall|synthesis|verdict|summary)/i;

export function factorDisplay(blocks: SectionBlock[] | null | undefined): FactorDisplay {
  const list = Array.isArray(blocks) ? blocks : [];
  const conclusion = list.find(b => CONCLUSION_RE.test(b.heading || '') && b.score !== undefined && b.score !== null);
  const source = conclusion ?? (list.length === 1 ? list[0] : undefined);

  const takeawaySource = conclusion ?? list.find(b => b.takeaway) ?? list[0];
  return {
    score: source?.score ?? null,
    sentiment: source?.sentiment ?? takeawaySource?.sentiment,
    takeaway: takeawaySource?.takeaway ?? null,
    blockScores: source
      ? []
      : list.filter(b => b.score !== undefined && b.score !== null)
            .map(b => ({ heading: b.heading, score: b.score as number })),
  };
}
