import { SectionBlock, sectionCertaintyText, sectionChainRefs, sectionInsight, sectionProjection } from '../services/supabase.service';
import { CHAIN_TOPICS, FactorDef } from './factors';

/** One category row of a module's committee conclusion, as BOTH the stock
 *  overview (factor tab) and the factor sub-page render it. The parsing lives
 *  here once so the two pages can never show the same section differently. */
export interface ConclusionRow {
  heading: string;
  /** Full Projection paragraph when the body has one; legacy rows keep the stored one-liner. */
  takeaway: string;
  /** Insight paragraphs (markdown) — the evidence under the Projection. */
  insight: string | null;
  /** Chain numbers the committee itself named as this section's inputs. */
  refs: number[];
  score: number | null;
  certainty: number | null;
  certaintyText: string | null;
}

export function conclusionRows(blocks: SectionBlock[] | null | undefined): ConclusionRow[] {
  return (blocks ?? [])
    .filter(b => b.takeaway)
    .map(b => ({
      heading: b.heading,
      takeaway: sectionProjection(b) ?? b.takeaway,
      insight: sectionInsight(b),
      refs: sectionChainRefs(b),
      score: b.score ?? null,
      certainty: b.certainty ?? null,
      certaintyText: sectionCertaintyText(b),
    }));
}

/** Conclusion scores are 0-100 bullishness — surfaced as stance words (the
 *  Horizons vocabulary), never as bare numbers. Exact score rides alongside. */
export function scoreStance(s: number): { label: string; band: string } {
  if (s >= 70) return { label: 'Bullish', band: 'bull' };
  if (s >= 55) return { label: 'Leans bullish', band: 'lean-bull' };
  if (s >= 45) return { label: 'Neutral', band: 'neutral' };
  if (s >= 30) return { label: 'Leans bearish', band: 'lean-bear' };
  return { label: 'Bearish', band: 'bear' };
}

/** Citation label for a chain the section names as its source —
 *  "Chain 2 · Balance Sheet" when the module's topic registry covers it. */
export function chainRefLabel(f: FactorDef, r: number): string {
  const topics = CHAIN_TOPICS[f.module];
  // last registry entry is the conclusion itself, not a numbered chain
  const topic = topics && r <= topics.length - 1 ? topics[r - 1] : null;
  return topic ? `Chain ${r} · ${topic}` : `Chain ${r}`;
}
