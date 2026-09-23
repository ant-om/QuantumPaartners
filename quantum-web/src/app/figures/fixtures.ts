import { Figure } from '../models/figure';

/** TEMPORARY. Figure specs keyed by `${TICKER}:${factorKey}` while the
 *  pipeline does not yet store numeric payloads beside its citation refs.
 *  Each entry was built from the run's real sources (Railway snapshot, FRED,
 *  SEC XBRL) for the TSLA row of 2026-08-23 — see each figure's `provenance`.
 *  Delete this file once L1 writes the payloads and the rail reads them from
 *  citation_refs. */
import { TSLA_PRICE_FIGURES } from './fixtures/tsla-price';
import { TSLA_MACRO_FIGURES } from './fixtures/tsla-macro';
import { TSLA_FINANCIAL_FIGURES } from './fixtures/tsla-financial';

export const FIGURE_FIXTURES: Record<string, Figure[]> = {
  'TSLA:price': TSLA_PRICE_FIGURES,
  'TSLA:macro': TSLA_MACRO_FIGURES,
  'TSLA:financial': TSLA_FINANCIAL_FIGURES,
};

export function fixtureFigures(ticker: string, factorKey: string): Figure[] {
  return FIGURE_FIXTURES[`${ticker.toUpperCase()}:${factorKey}`] ?? [];
}
