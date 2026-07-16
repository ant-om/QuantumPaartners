import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService, Stock, StockAnalysis, SectionBlock, FactorChain } from '../../services/supabase.service';
import { FactorDef, FactorDisplay, factorBySlug, factorDisplay, prevNextFactor } from '../../models/factors';

/** /stock/:ticker/:factor — one factor's full analysis + the round-4 Q&A
 *  reasoning chain (our differentiator: the reasoning is inspectable). */
@Component({
  selector: 'app-factor-detail',
  standalone: false,
  templateUrl: './factor-detail.component.html',
})
export class FactorDetailComponent implements OnInit {
  stock: Stock | null = null;
  analysis: StockAnalysis | null = null;
  factor: FactorDef | null = null;
  display: FactorDisplay | null = null;
  chain: FactorChain | null = null;
  chainLoading = true;
  prev: FactorDef | null = null;
  next: FactorDef | null = null;
  loading = true;
  notFound = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private supabase: SupabaseService,
  ) {}

  ngOnInit(): void {
    // params (not snapshot): prev/next links navigate within this component
    this.route.paramMap.subscribe(pm => {
      void this.load(pm.get('ticker') ?? '', pm.get('factor'));
    });
  }

  private async load(ticker: string, slug: string | null): Promise<void> {
    this.loading = true;
    this.notFound = false;
    this.chain = null;
    this.chainLoading = true;

    const factor = factorBySlug(slug);
    if (!factor) {
      // invalid slug → the stock page
      void this.router.navigate(['/stock', ticker], { replaceUrl: true });
      return;
    }
    this.factor = factor;
    const pn = prevNextFactor(factor.slug);
    this.prev = pn.prev;
    this.next = pn.next;

    if (this.stock?.ticker !== ticker.toUpperCase()) {
      this.stock = await this.supabase.getStockByTicker(ticker);
      this.analysis = this.stock ? await this.supabase.getAnalysis(this.stock.id) : null;
    }
    if (!this.stock) {
      this.notFound = true;
      this.loading = false;
      return;
    }

    this.display = factorDisplay(this.blocks);
    this.loading = false;

    // Round-4 chain is fetched lazily — it is NOT part of getAnalysis
    this.chain = await this.supabase.getFactorChain(this.stock.id, factor.module);
    this.chainLoading = false;
  }

  get blocks(): SectionBlock[] | null {
    return this.factor ? ((this.analysis as unknown as Record<string, SectionBlock[] | null>)?.[this.factor.key] ?? null) : null;
  }

  get metricsPlacement(): 'price' | 'financial' | null {
    if (!this.analysis?.metrics) return null;
    if (this.factor?.key === 'price') return 'price';
    if (this.factor?.key === 'financial') return 'financial';
    return null;
  }
}
