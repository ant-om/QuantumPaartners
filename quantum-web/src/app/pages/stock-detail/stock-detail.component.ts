import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService, Stock, StockAnalysis, SectionBlock, ScoreHistoryPoint, AnalysisVerdict, HorizonStance } from '../../services/supabase.service';
import { SeoService } from '../../services/seo.service';
import { LogoService } from '../../services/logo.service';
import { FACTORS, FactorDef } from '../../models/factors';

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
      toc.push({ key: 'factors', label: 'Factor scores' });
      if (this.analysis.metrics) toc.push({ key: 'charts', label: 'Charts' });
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

  takeaways(key: string): { heading: string; takeaway: string }[] {
    return (this.blocks(key) ?? [])
      .filter(b => b.takeaway)
      .map(b => ({ heading: b.heading, takeaway: b.takeaway }));
  }

  goHome() {
    this.router.navigate(['/']);
  }
}
