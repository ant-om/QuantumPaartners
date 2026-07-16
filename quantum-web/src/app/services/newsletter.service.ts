import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export type SubscribeResult = 'ok' | 'duplicate' | 'invalid' | 'error';

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/** Newsletter signups → Supabase newsletter_subscribers
 *  (doc/sql/newsletter_subscribers.sql — anon INSERT-only, no SELECT). */
@Injectable({ providedIn: 'root' })
export class NewsletterService {
  constructor(private supabase: SupabaseService) {}

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
