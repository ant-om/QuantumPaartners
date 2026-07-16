import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SupabaseService } from './supabase.service';

export type SubscribeResult = 'ok' | 'duplicate' | 'invalid' | 'error';

export interface NewsletterEdition {
  ticker: string;
  date: string;
  edition_text: string;
  word_count: number | null;
  generated_at: string;
}

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/** Newsletter signups → Supabase newsletter_subscribers
 *  (doc/sql/newsletter_subscribers.sql — anon INSERT-only, no SELECT). */
@Injectable({ providedIn: 'root' })
export class NewsletterService {
  private readonly isBrowser: boolean;

  constructor(
    private supabase: SupabaseService,
    @Inject(PLATFORM_ID) platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /** Latest published edition via the site's own /api proxy (SSR server).
   *  Browser-only: /newsletter is prerendered, the edition hydrates in. */
  async getLatestEdition(): Promise<NewsletterEdition | null> {
    if (!this.isBrowser) return null;
    try {
      const res = await fetch('/api/newsletter/latest');
      if (!res.ok || res.status === 204) return null;
      const row = (await res.json()) as NewsletterEdition;
      return row?.edition_text ? row : null;
    } catch {
      return null;
    }
  }

  async subscribe(email: string, source = 'site'): Promise<SubscribeResult> {
    const clean = (email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(clean) || clean.length > 254) return 'invalid';

    // No .select() after insert — the table deliberately has no SELECT policy.
    const { error } = await this.supabase.supabase
      .from('newsletter_subscribers')
      .insert({ email: clean, source });

    if (!error) return 'ok';
    if (error.code === '23505') return 'duplicate'; // unique(lower(email))
    return 'error';
  }
}
