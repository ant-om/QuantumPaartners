import { Component, Input } from '@angular/core';
import { NewsletterService } from '../../services/newsletter.service';

type FormState = 'idle' | 'loading' | 'done' | 'duplicate' | 'invalid' | 'error';

/** "Get free Stock Bar newsletter" capture form. Honeypot field included —
 *  bots that fill `company` are silently accepted without an insert. */
@Component({
  selector: 'app-newsletter-signup',
  standalone: false,
  template: `
    <form class="nl-form" (ngSubmit)="submit()" [class.nl-compact]="compact">
      <p *ngIf="!compact" class="nl-pitch">
        Get the <b>free Stock Bar newsletter</b> — the day's AI stock analysis, in your inbox.
      </p>
      <div class="nl-row" *ngIf="state !== 'done' && state !== 'duplicate'">
        <input class="nl-input" type="email" name="email" [(ngModel)]="email"
               placeholder="you@example.com" autocomplete="email" [disabled]="state === 'loading'"
               aria-label="Email address">
        <!-- honeypot: humans never see or fill this -->
        <input class="nl-hp" type="text" name="company" [(ngModel)]="company"
               tabindex="-1" autocomplete="off" aria-hidden="true">
        <button class="qp-btn" type="submit" [disabled]="state === 'loading'">
          {{ state === 'loading' ? 'Subscribing…' : 'Subscribe' }}
        </button>
      </div>
      <p *ngIf="state === 'done'" class="nl-msg nl-ok">You're in — first edition lands with the next update. 🎉</p>
      <p *ngIf="state === 'duplicate'" class="nl-msg nl-ok">You're already subscribed — nothing else to do.</p>
      <p *ngIf="state === 'invalid'" class="nl-msg nl-err">That doesn't look like an email address — mind checking it?</p>
      <p *ngIf="state === 'error'" class="nl-msg nl-err">Something went wrong on our side. Please try again in a minute.</p>
    </form>
  `,
  styles: [`
    .nl-form { max-width: 480px; }
    .nl-pitch { font-size:0.92rem; color:var(--text-2); margin:0 0 10px; }
    .nl-pitch b { color:var(--text); }
    .nl-row { display:flex; gap:8px; }
    .nl-input { flex:1; min-width:0; background:var(--card); border:1px solid var(--border-strong);
      border-radius:var(--r-md); padding:11px 14px; font-family:var(--font-body);
      font-size:0.92rem; color:var(--text); outline:none; transition:border-color .2s, box-shadow .2s; }
    .nl-input:focus { border-color:var(--oxford); box-shadow:0 0 0 3px rgba(15,84,153,0.12); }
    .nl-input::placeholder { color:var(--text-muted); }
    .nl-hp { position:absolute; left:-9999px; width:1px; height:1px; opacity:0; }
    .nl-msg { font-size:0.88rem; margin:6px 0 0; }
    .nl-ok { color:var(--bull); }
    .nl-err { color:var(--bear); }
    .nl-compact .nl-pitch { display:none; }
  `],
})
export class NewsletterSignupComponent {
  @Input() source = 'site';
  @Input() compact = false;

  email = '';
  company = ''; // honeypot
  state: FormState = 'idle';

  constructor(private newsletter: NewsletterService) {}

  async submit(): Promise<void> {
    if (this.state === 'loading') return;
    if (this.company.trim()) { this.state = 'done'; return; } // bot: pretend success
    this.state = 'loading';
    this.state = await this.newsletter.subscribe(this.email, this.source).then(
      r => (r === 'ok' ? 'done' : r) as FormState,
      () => 'error' as FormState,
    );
  }
}
