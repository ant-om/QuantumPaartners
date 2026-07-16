import { Component, OnInit } from '@angular/core';
import { SeoService } from '../../services/seo.service';
import { NewsletterService, NewsletterEdition } from '../../services/newsletter.service';

@Component({
  selector: 'app-newsletter-page',
  standalone: false,
  template: `
    <div class="qp-detail qp-static-page">
      <div class="qp-eyebrow">Newsletter</div>
      <h1 class="qp-static-title">Get the free Stock Bar newsletter</h1>
      <p class="qp-static-lead">
        Every edition distills our full multi-agent pipeline — macro, political,
        financials, competition, management, sentiment and price action — into
        one plain-English read on the market. Free, no paywall, unsubscribe anytime.
      </p>
      <app-newsletter-signup source="newsletter-page"></app-newsletter-signup>

      <div class="qp-section">
        <h2 class="qp-section-heading">What you'll get</h2>
        <ul class="qp-static-list">
          <li><b>The day's read.</b> What the seven analysis lenses concluded, and where they disagree.</li>
          <li><b>What changed.</b> Score moves since the last edition — measured, not vibes.</li>
          <li><b>The reasoning.</b> Every claim links back to a full, inspectable analysis chain on the site.</li>
        </ul>
        <p class="qp-static-note">
          AI-generated research for informational purposes only. Not investment advice.
        </p>
      </div>

      <!-- Latest edition (hydrates in the browser; hidden when unavailable) -->
      <div class="qp-section" *ngIf="edition">
        <h2 class="qp-section-heading">The latest edition</h2>
        <article class="qp-edition">
          <div class="qp-edition-masthead qp-mono">{{ edition.date | date:'fullDate' }} · {{ edition.word_count }} words</div>
          <pre class="qp-edition-body">{{ edition.edition_text }}</pre>
        </article>
      </div>
    </div>
  `,
})
export class NewsletterPageComponent implements OnInit {
  edition: NewsletterEdition | null = null;

  constructor(private seo: SeoService, private newsletter: NewsletterService) {}

  async ngOnInit(): Promise<void> {
    this.seo.set({
      title: 'Get the free Stock Bar newsletter',
      description: "The day's AI stock analysis, distilled into one plain-English read. Free, no paywall, unsubscribe anytime.",
      canonicalPath: '/newsletter',
    });
    this.edition = await this.newsletter.getLatestEdition();
  }
}
