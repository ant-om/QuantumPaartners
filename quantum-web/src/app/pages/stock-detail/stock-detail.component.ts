import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService, Stock, StockAnalysis, SectionBlock, ScoreHistoryPoint } from '../../services/supabase.service';
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

  readonly factors: FactorDef[] = FACTORS;

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
    private supabase: SupabaseService
  ) {}

  async ngOnInit() {
    const ticker = this.route.snapshot.paramMap.get('ticker') ?? '';
    this.stock = await this.supabase.getStockByTicker(ticker);
    if (!this.stock) {
      this.notFound = true;
      this.loading = false;
      return;
    }
    this.analysis = await this.supabase.getAnalysis(this.stock.id);
    this.loading = false;
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
