import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService, Stock } from '../../services/supabase.service';

@Component({
  selector: 'app-home',
  standalone: false,
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit {
  stocks: Stock[] = [];
  /** Search result fed to the fan carousel. A stable field (recomputed only on
   *  query change), NOT a getter — a getter returns a new array every change-
   *  detection cycle, which would make the fan replay its entry animation. */
  filtered: Stock[] = [];
  query = '';
  loading = true;

  onSearch(): void {
    const q = this.query.toLowerCase().trim();
    this.filtered = !q
      ? this.stocks
      : this.stocks.filter(s =>
          s.ticker.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.sector?.toLowerCase().includes(q),
        );
  }

  constructor(private supabase: SupabaseService, public router: Router) {}

  async ngOnInit() {
    this.stocks = await this.supabase.getStocks();
    this.filtered = this.stocks;
    this.loading = false;
  }

}
