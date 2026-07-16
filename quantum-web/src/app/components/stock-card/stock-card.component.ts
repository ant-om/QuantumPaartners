import { Component, Input } from '@angular/core';
import { Stock } from '../../services/supabase.service';
import { LogoService } from '../../services/logo.service';

/** Professional stock card — white, 1px border, claret top bar.
 *  The whole card is a real <a routerLink> so it is crawlable. */
@Component({
  selector: 'app-stock-card',
  standalone: false,
  template: `
    <a class="sc-card" [routerLink]="['/stock', stock.ticker]">
      <div class="sc-topbar"></div>
      <div class="sc-head">
        <div class="sc-logo-wrap">
          <img *ngIf="logoUrl && !logoFailed" [src]="logoUrl"
               [alt]="stock.name + ' logo'" class="sc-logo" loading="lazy"
               (error)="logoFailed = true">
          <span *ngIf="!logoUrl || logoFailed" class="sc-monogram">{{ monogram }}</span>
        </div>
        <span class="sc-ticker qp-mono">{{ stock.ticker }}</span>
      </div>
      <h3 class="sc-name">{{ stock.name }}</h3>
      <p class="sc-meta">
        <span *ngIf="stock.sector">{{ stock.sector }}</span>
        <span *ngIf="stock.sector && stock.exchange" class="sc-meta-dot">·</span>
        <span *ngIf="stock.exchange">{{ stock.exchange }}</span>
      </p>
      <span class="sc-cta">Read analysis →</span>
    </a>
  `,
  styles: [`
    .sc-card { position:relative; display:flex; flex-direction:column; background:var(--card);
      border:1px solid var(--border); border-radius:var(--r-lg); padding:20px 20px 18px;
      overflow:hidden; transition:border-color .2s, box-shadow .2s, transform .2s; }
    .sc-card:hover { border-color:var(--border-strong); box-shadow:var(--shadow);
      transform:translateY(-2px); }
    .sc-topbar { position:absolute; top:0; left:0; right:0; height:3px; background:var(--claret); }
    .sc-head { display:flex; align-items:center; justify-content:space-between; gap:10px;
      margin-bottom:14px; }
    .sc-logo-wrap { width:40px; height:40px; border:1px solid var(--border);
      border-radius:var(--r-md); background:#fff; display:flex; align-items:center;
      justify-content:center; overflow:hidden; flex-shrink:0; }
    .sc-logo { max-width:30px; max-height:30px; object-fit:contain; }
    .sc-monogram { font-family:var(--font-mono); font-size:0.82rem; font-weight:700;
      color:var(--text-2); letter-spacing:0.04em; }
    .sc-ticker { font-size:0.76rem; font-weight:700; letter-spacing:0.1em; color:var(--claret); }
    .sc-name { font-family:var(--font-display); font-size:1.08rem; font-weight:700;
      color:var(--text); line-height:1.25; margin:0 0 6px; }
    .sc-meta { font-size:0.78rem; color:var(--text-muted); margin:0 0 16px; line-height:1.5; }
    .sc-meta-dot { margin:0 5px; }
    .sc-cta { margin-top:auto; font-size:0.8rem; font-weight:600; color:var(--oxford); }
    .sc-card:hover .sc-cta { text-decoration:underline; }
  `],
})
export class StockCardComponent {
  @Input({ required: true }) stock!: Stock;
  logoFailed = false;

  constructor(private logos: LogoService) {}

  get logoUrl(): string {
    return this.logos.resolve(this.stock);
  }

  get monogram(): string {
    return (this.stock?.ticker || '?').slice(0, 2).toUpperCase();
  }
}
