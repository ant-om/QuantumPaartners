/** A figure the module page draws in its right rail, beside the paragraph
 *  that cites its source. The numbers never come from the model: they are the
 *  L1 payload behind a citation tag (FRED series, Railway snapshot, SEC XBRL,
 *  Polymarket odds…). The page only decides WHERE it sits — next to the
 *  conclusion section or chain that carries the tag — and draws it.
 *
 *  Until L1 writes these payloads beside its citation refs, the specs come
 *  from fixtures (see figures/fixtures.ts). The shape is the contract. */
export type FigureKind = 'line' | 'bars' | 'band';

export interface FigurePoint {
  /** ISO date for time series, or a category label ("2026-Q2"). */
  x: string;
  y: number;
  /** Upper bound for a band (y is then the lower bound). */
  y2?: number;
}

export interface FigureSeries {
  name: string;
  points: FigurePoint[];
}

export interface FigureRule { y: number; label: string; }
export interface FigureMarker { x: string; y: number; label: string; }

export interface FigureAnchor {
  where: 'conclusion' | 'chain';
  /** 1-based position of the conclusion section or chain on the page. */
  index: number;
  tags: string[];
  /** Opening of the sentence the figure sits beside (for provenance, not shown). */
  quote?: string;
}

export interface FigureSource {
  name: string;
  url?: string;
  as_of: string;
  as_of_kind?: string;
}

export interface Figure {
  id: string;
  module: string;
  kind: FigureKind;
  title: string;
  unit?: string;
  series: FigureSeries[];
  rules?: FigureRule[];
  markers?: FigureMarker[];
  anchor: FigureAnchor;
  caption?: string;
  source: FigureSource;
  provenance?: string;
}

/** Anchor element id on the factor page: conclusion rows are `concl-N`, chains `chain-N`. */
export function figureAnchorId(f: Figure): string {
  return (f.anchor.where === 'chain' ? 'chain-' : 'concl-') + f.anchor.index;
}
