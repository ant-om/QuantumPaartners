import { Component, OnInit } from '@angular/core';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-about-page',
  standalone: false,
  template: `
    <div class="qp-detail qp-static-page">
      <div class="qp-eyebrow">About</div>
      <h1 class="qp-static-title">Free, verified AI stock analysis — for everyone</h1>
      <p class="qp-static-lead">
        Stock Bar exists because serious equity research shouldn't sit behind a
        paywall. Our analysis is produced by a multi-agent AI pipeline, published
        in full — including its reasoning — and updated daily.
      </p>

      <div class="qp-section">
        <h2 class="qp-section-heading">How the analysis is made</h2>
        <p class="qp-static-p">
          Every stock runs through a five-layer pipeline. Nothing you read here is
          a single model's hot take — each conclusion survives retrieval, seven
          independent analyses, and several rounds of cross-examination first.
        </p>
        <ol class="qp-method-steps">
          <li><b>L1 — Retrieval.</b> Fresh market data, filings, news, and policy signals are gathered per stock and indexed into a vector knowledge base.</li>
          <li><b>L2 — Factor analysis.</b> Seven specialist lenses — macro, political, financials, competition, management, sentiment, price — each run a multi-step Q&amp;A chain over the evidence and score the stock independently.</li>
          <li><b>L3 — The meeting.</b> The lenses challenge each other's conclusions over several structured rounds, surfacing disagreements instead of hiding them.</li>
          <li><b>L4 — Refinement.</b> Each lens rewrites its analysis with the meeting's objections in hand. These refined chains are what you see on every factor page.</li>
          <li><b>L5 — Synthesis.</b> A final pass distills everything into the summary, scores, and takeaways on each stock page.</li>
        </ol>
        <p class="qp-static-p">
          The quant figures (price history, volatility, Monte Carlo ranges, factor
          models) come from a live market-data service, not from the language
          models — the AI interprets them, it never invents them.
        </p>
      </div>

      <div class="qp-section">
        <h2 class="qp-section-heading">Why the reasoning is public</h2>
        <p class="qp-static-p">
          Scores without reasoning are noise. Every factor page shows the full,
          unedited analysis chain behind its score, so you can judge the argument
          — not just trust a number. When the pipeline has thin evidence, the
          analysis says so.
        </p>
      </div>

      <div class="qp-section">
        <h2 class="qp-section-heading">Cadence</h2>
        <p class="qp-static-p">
          Analyses refresh daily. Each page shows its last-updated date; the
          newsletter goes out when a new edition is published.
        </p>
      </div>

      <div class="qp-section">
        <h2 class="qp-section-heading">Disclaimer</h2>
        <p class="qp-static-p">
          Stock Bar is AI-generated research for informational and educational
          purposes only. It is not investment advice, not a recommendation to buy
          or sell any security, and not a substitute for a licensed financial
          adviser. Markets are risky; do your own research.
        </p>
      </div>

      <div class="qp-section">
        <h2 class="qp-section-heading">Stay in the loop</h2>
        <app-newsletter-signup source="about-page"></app-newsletter-signup>
      </div>
    </div>
  `,
})
export class AboutPageComponent implements OnInit {
  constructor(private seo: SeoService) {}
  ngOnInit(): void {
    this.seo.set({
      title: 'About — how our AI analysis works',
      description: 'Stock Bar publishes free, verified AI stock analysis with the full reasoning behind every score. Here is exactly how the five-layer pipeline works.',
      canonicalPath: '/about',
    });
  }
}
