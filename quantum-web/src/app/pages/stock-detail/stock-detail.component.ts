import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService, Stock, StockAnalysis, SectionBlock, ScoreHistoryPoint, AnalysisVerdict, HorizonStance, Sentiment } from '../../services/supabase.service';
import { SeoService } from '../../services/seo.service';
import { LogoService } from '../../services/logo.service';
import { FACTORS, FactorDef, factorDisplay } from '../../models/factors';

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
  logoFailed = false;
  aboutOpen = false;

  /** Per-factor conclusion sentiment for the TOC chips — computed once per load. */
  factorSentiments: Record<string, Sentiment | undefined> = {};

  get logoUrl(): string {
    return this.stock ? this.logos.resolve(this.stock) : '';
  }

  readonly factors: FactorDef[] = FACTORS;

  /** R5 committee verdict — present only on new-structurer rows. Strictly
   *  feature-detected: anything malformed falls back to the legacy gauge. */
  get verdict(): AnalysisVerdict | null {
    const v = this.analysis?.summary?.verdict;
    if (!v || !['BUY', 'HOLD', 'SELL'].includes(v.recommendation)) return null;
    return v;
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
      toc.push(...this.factors.map(f => ({ key: f.key, label: f.short })));
    }
    return toc;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private supabase: SupabaseService,
    private seo: SeoService,
    private logos: LogoService
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
    for (const f of this.factors) this.factorSentiments[f.key] = factorDisplay(this.blocks(f.key)).sentiment;
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

  takeaways(key: string): { heading: string; takeaway: string; score: number | null }[] {
    return (this.blocks(key) ?? [])
      .filter(b => b.takeaway)
      .map(b => ({ heading: b.heading, takeaway: b.takeaway, score: b.score ?? null }));
  }

  /** Same score banding used across the site (block-score-bars, factor pages). */
  scoreColor(s: number): string {
    if (s >= 66) return 'var(--bull)';
    if (s >= 33) return 'var(--warn)';
    return 'var(--bear)';
  }

  goHome() {
    this.router.navigate(['/']);
  }
}
