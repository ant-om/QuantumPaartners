import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export interface Quote {
  ticker: string;
  price?: number;
  change?: number;
  change_pct?: number;
  error?: boolean;
}

@Injectable({ providedIn: 'root' })
export class QuotesService {
  private readonly base = (environment as { priceApiUrl?: string }).priceApiUrl
    ?? 'https://quantum-price-prompt.up.railway.app';

  /** Fetch live quotes for the given tickers. Resolves to [] on any failure
   *  so callers can fall back to placeholders — the tape must never error out. */
  async getQuotes(tickers: string[]): Promise<Quote[]> {
    if (!tickers.length) return [];
    const url = `${this.base}/quotes?tickers=${encodeURIComponent(tickers.join(','))}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body?.quotes) ? (body.quotes as Quote[]) : [];
    } catch {
      return [];
    }
  }
}
