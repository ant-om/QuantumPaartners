import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService, Stock, StockAnalysis, SectionBlock, ScoreHistoryPoint, AnalysisVerdict, HorizonStance, Sentiment, sectionProjection, sectionInsight, sectionChainRefs, sectionCertaintyText, r5CaseEvaluations } from '../../services/supabase.service';
import { SeoService } from '../../services/seo.service';
import { CHAIN_TOPICS, FACTORS, FactorDef, factorDisplay } from '../../models/factors';

@Component({
  selector: 'app-stock-detail',
  standalone: false,
  templateUrl: './stock-detail.component.html',
  styleUrl: './stock-detail.component.css'
})
export class StockDetailComponent implements OnInit {
  stock: Stock | null = null;
  analysis: StockAnalysis | null = null;
  history: ScoreHistoryPoint[] = [];
  loading = true;
  notFound = false;
  aboutOpen = false;

  /** Per-factor conclusion sentiment for the section-header chips — computed once per load. */
  factorSentiments: Record<string, Sentiment | undefined> = {};

  /** Factors with conclusions, split into two height-balanced columns.
   *  Explicit columns instead of CSS multicol — Chrome clips/bleeds cards
   *  with break-inside:avoid in a multicol flow. */
  /** Factors that have conclusions — the tab strip. */
  presentFactors: FactorDef[] = [];
  activeFactorKey = '';

  readonly factors: FactorDef[] = FACTORS;

  /** R5 committee verdict — present only on new-structurer rows. Strictly
   *  feature-detected: anything malformed falls back to the legacy gauge. */
  get verdict(): AnalysisVerdict | null {
    const v = this.analysis?.summary?.verdict;
    if (!v || !['BUY', 'HOLD', 'SELL'].includes(v.recommendation)) return null;
    return v;
  }

  /** "Committee view | The other side" toggle on the summary card. Under a
   *  directional verdict only the OPPOSITE case appears (the aligned case IS
   *  the narrative); a HOLD shows both. Empty on legacy rows. */
  summaryView: 'committee' | 'bull' | 'bear' = 'committee';
  otherViews: { key: 'bull' | 'bear'; label: string; text: string }[] = [];

  private buildOtherViews(): void {
    this.summaryView = 'committee';
    this.otherViews = [];
    const cases = r5CaseEvaluations(this.analysis?.r5_synthesis);
    const rec = this.verdict?.recommendation;
    if (rec === 'SELL' && cases.bull) {
      this.otherViews.push({ key: 'bull', label: 'The other side', text: cases.bull });
    } else if (rec === 'BUY' && cases.bear) {
      this.otherViews.push({ key: 'bear', label: 'The other side', text: cases.bear });
    } else if (rec === 'HOLD') {
      if (cases.bull) this.otherViews.push({ key: 'bull', label: 'Bull case', text: cases.bull });
      if (cases.bear) this.otherViews.push({ key: 'bear', label: 'Bear case', text: cases.bear });
    }
  }

  /** Risk bullets carry a bold lead phrase as markdown — render the bold,
   *  never the literal asterisks. Escaped first, so only our <b> survives. */
  bulletHtml(b: string): string {
    return b
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/[*_`]+/g, '');
  }

  /** Horizon strip rows (Short / Medium / Long), skipping absent horizons.
   *  Computed once per analysis load — not a getter, to keep *ngFor stable. */
  horizonRows: { label: string; range: string; stance: HorizonStance; rationale: string }[] = [];

  private buildHorizonRows(): void {
    const h = this.verdict?.horizons;
    if (!h) { this.horizonRows = []; return; }
    const defs: { key: 'short' | 'medium' | 'long'; label: string; range: string }[] = [
      { key: 'short', label: 'Short', range: '0–3 mo' },
      { key: 'medium', label: 'Medium', range: '3–12 mo' },
      { key: 'long', label: 'Long', range: '12+ mo' },
    ];
    this.horizonRows = defs
      .filter(d => !!h[d.key]?.stance)
      .map(d => ({ label: d.label, range: d.range, stance: h[d.key]!.stance, rationale: h[d.key]!.rationale ?? '' }));
  }

  // TOC entries — anchors match the section ids in the template
  get tocSections() {
    const toc = [{ key: 'summary', label: 'Overview' }];
    if (this.analysis) {
      if (this.history.length >= 2) toc.push({ key: 'charts', label: 'Score evolution' });
      toc.push({ key: 'factors', label: 'The seven factors' });
    }
    return toc;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private supabase: SupabaseService,
    private seo: SeoService
  ) {}

  async ngOnInit() {
    const ticker = this.route.snapshot.paramMap.get('ticker') ?? '';
    this.stock = await this.supabase.getStockByTicker(ticker);
    if (!this.stock) {
      this.notFound = true;
      this.loading = false;
      this.seo.set({ title: 'Stock not found', noindex: true });
      return;
    }
    this.analysis = await this.supabase.getAnalysis(this.stock.id);
    this.buildHorizonRows();
    this.buildOtherViews();
    for (const f of this.factors) this.factorSentiments[f.key] = factorDisplay(this.blocks(f.key)).sentiment;
    this.presentFactors = this.factors.filter(f => this.takeaways(f.key).length);
    this.activeFactorKey = this.presentFactors[0]?.key ?? '';
    this.loading = false;
    this.seo.set({
      title: `${this.stock.ticker} Stock Analysis & AI Score — ${this.stock.name}`,
      description: this.analysis?.summary?.headline
        ?? `AI analysis of ${this.stock.name} (${this.stock.ticker}) across seven factors, updated daily.`,
      canonicalPath: `/stock/${this.stock.ticker}`,
      ogType: 'article',
      jsonLd: {
        '@context': 'https://schema.org', '@type': 'Article',
        headline: this.analysis?.summary?.headline ?? `${this.stock.ticker} AI stock analysis`,
        about: { '@type': 'Corporation', name: this.stock.name, tickerSymbol: this.stock.ticker },
        dateModified: this.analysis?.run_at, author: { '@type': 'Organization', name: 'Stock Bar' },
      },
    });
    // score history is optional (view may not exist yet) — never blocks render
    this.history = await this.supabase.getScoreHistory(this.stock.id);
  }

  blocks(key: string): SectionBlock[] | null {
    return (this.analysis as any)?.[key] ?? null;
  }

  takeaways(key: string): { heading: string; takeaway: string; insight: string | null; refs: number[]; score: number | null; certainty: number | null; certaintyText: string | null }[] {
    return (this.blocks(key) ?? [])
      .filter(b => b.takeaway)
      .map(b => ({
        heading: b.heading,
        // full Projection paragraph when the body has one; legacy rows keep the stored one-liner
        takeaway: sectionProjection(b) ?? b.takeaway,
        insight: sectionInsight(b),
        refs: sectionChainRefs(b),
        score: b.score ?? null,
        certainty: b.certainty ?? null,
        certaintyText: sectionCertaintyText(b),
      }));
  }

  /** Citation label for a chain the section names as its source —
   *  "Chain 2 · Balance Sheet" when the module's topic registry covers it. */
  chainRefLabel(f: FactorDef, r: number): string {
    const topics = CHAIN_TOPICS[f.module];
    // last registry entry is the conclusion itself, not a numbered chain
    const topic = topics && r <= topics.length - 1 ? topics[r - 1] : null;
    return topic ? `Chain ${r} · ${topic}` : `Chain ${r}`;
  }

  /** Conclusion scores are 0-100 bullishness — surface them as stance words
   *  (the Horizons vocabulary), not bare numbers. Exact score stays on hover. */
  scoreStance(s: number): { label: string; band: string } {
    if (s >= 70) return { label: 'Bullish', band: 'bull' };
    if (s >= 55) return { label: 'Leans bullish', band: 'lean-bull' };
    if (s >= 45) return { label: 'Neutral', band: 'neutral' };
    if (s >= 30) return { label: 'Leans bearish', band: 'lean-bear' };
    return { label: 'Bearish', band: 'bear' };
  }

  dotColor(key: string): string {
    const s = this.factorSentiments[key];
    return s === 'positive' ? 'var(--bull)' : s === 'negative' ? 'var(--bear)' : 'var(--text-muted)';
  }

  setTab(key: string) {
    this.activeFactorKey = key;
  }

  goHome() {
    this.router.navigate(['/']);
  }
}
