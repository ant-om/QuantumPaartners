import { Component } from '@angular/core';

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
    </div>
  `,
})
export class NewsletterPageComponent {}
