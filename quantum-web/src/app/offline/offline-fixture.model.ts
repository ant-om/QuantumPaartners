/** Shape of the dev-only offline fixture — see offline-fixture.ts. Kept in its
 *  own module because the offline build file-replaces offline-fixture.ts. */
export interface OfflineFixture {
  /** `stocks` row, as getStockByTicker returns it. */
  stock: Record<string, unknown> & { id: string; ticker: string };
  /** `stock_analyses` row in the shape getAnalysis selects (before cleaning). */
  analysis: Record<string, unknown>;
  /** raw_output per module key ('political', 'price', … 'fs'). */
  chains: Record<string, unknown>;
  /** citation_refs rows ({module, refs}) for the analysis run date. */
  citationRows: unknown[];
}
