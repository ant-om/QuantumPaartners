import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Stock } from './supabase.service';

/** Logo resolve chain: stock.logo_url → sp500-logos.json override → ticker-keyed
 *  CDN pattern. Consumers keep an <img (error)> monogram fallback for 404s. */
@Injectable({ providedIn: 'root' })
export class LogoService {
  private overrides: Record<string, string> = {};

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    if (isPlatformBrowser(platformId)) {
      fetch('/data/sp500-logos.json')
        .then(r => (r.ok ? r.json() : {}))
        .then(map => { this.overrides = map; })
        .catch(() => { /* pattern fallback still works */ });
    }
  }

  resolve(stock: Pick<Stock, 'ticker' | 'logo_url'>): string {
    const t = (stock.ticker || '').toUpperCase();
    return stock.logo_url
      || this.overrides[t]
      || `https://financialmodelingprep.com/image-stock/${t}.png`;
  }
}
