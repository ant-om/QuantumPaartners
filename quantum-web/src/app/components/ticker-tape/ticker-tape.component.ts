import {
  Component,
  NgZone,
  OnDestroy,
  OnInit,
  ChangeDetectorRef,
} from '@angular/core';
import { QuotesService, Quote } from '../../services/quotes.service';

/** Broker-style running ticker tape. Shows a curated set of popular tickers,
 *  polls live quotes from the price API, and scrolls them in an infinite
 *  marquee. Renders placeholders immediately so the bar is never empty. */
@Component({
  selector: 'app-ticker-tape',
  standalone: false,
  templateUrl: './ticker-tape.component.html',
  styleUrl: './ticker-tape.component.css',
})
export class TickerTapeComponent implements OnInit, OnDestroy {
  /** Popular mega-caps + a couple of our covered names. */
  readonly symbols = [
    'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL',
    'META', 'AMD', 'NFLX', 'JPM', 'PEP', 'PLTR',
  ];

  quotes: Quote[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private readonly REFRESH_MS = 60_000;

  constructor(
    private quotesSvc: QuotesService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    // placeholders first so the tape paints instantly
    this.quotes = this.symbols.map(t => ({ ticker: t }));
    this.refresh();
    // poll outside Angular to avoid spurious change-detection churn
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => this.refresh(), this.REFRESH_MS);
    });
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The marquee renders the list twice for a seamless loop. */
  get loop(): Quote[] {
    return [...this.quotes, ...this.quotes];
  }

  private async refresh(): Promise<void> {
    const fresh = await this.quotesSvc.getQuotes(this.symbols);
    if (!fresh.length) return; // keep existing/placeholder values
    const byTicker = new Map(fresh.map(q => [q.ticker, q]));
    this.zone.run(() => {
      this.quotes = this.symbols.map(t => byTicker.get(t) ?? { ticker: t });
      this.cdr.markForCheck();
    });
  }

  trackByTicker(_: number, q: Quote): string {
    return q.ticker;
  }
}
