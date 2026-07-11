import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService, Stock, StockAnalysis, SectionBlock } from '../../services/supabase.service';

@Component({
  selector: 'app-stock-detail',
  standalone: false,
  templateUrl: './stock-detail.component.html',
  styleUrl: './stock-detail.component.css'
})
export class StockDetailComponent implements OnInit {
  stock: Stock | null = null;
  analysis: StockAnalysis | null = null;
  loading = true;
  notFound = false;

  sections = [
    { key: 'political',  label: 'Political & Regulatory' },
    { key: 'price',      label: 'Price Action' },
    { key: 'macro',      label: 'Macroeconomic Environment' },
    { key: 'management', label: 'Management & Governance' },
    { key: 'sentiment',  label: 'Market Sentiment' },
    { key: 'competitor', label: 'Competitive Landscape' },
    { key: 'financial',  label: 'Financial Health' },
  ];

  // TOC entries (overview + the price-chart anchor render as sections too)
  get tocSections() {
    return [{ key: 'summary', label: 'Overview' }, ...this.sections];
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
  }

  blocks(key: string): SectionBlock[] | null {
    return (this.analysis as any)?.[key] ?? null;
  }

  goHome() {
    this.router.navigate(['/']);
  }
}
