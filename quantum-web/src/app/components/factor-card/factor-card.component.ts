import { Component, Input, OnChanges } from '@angular/core';
import { SectionBlock } from '../../services/supabase.service';
import { FactorDef, FactorDisplay, factorDisplay } from '../../models/factors';

/** One of the 7 factor cards on the stock page (Danelfin-style decomposition).
 *  Score + sentiment come DIRECTLY from the analysis blocks; when no single
 *  score exists the block scores are shown as-is (mini bars, no averaging). */
@Component({
  selector: 'app-factor-card',
  standalone: false,
  template: `
    <a class="fc-card" [routerLink]="['/stock', ticker, factor.slug]">
      <div class="fc-head">
        <span class="fc-label">{{ factor.label }}</span>
        <app-score-gauge *ngIf="display.score !== null" [score]="display.score" [size]="44"></app-score-gauge>
      </div>
      <app-sentiment-chip [sentiment]="display.sentiment"></app-sentiment-chip>
      <p *ngIf="display.takeaway" class="fc-takeaway">{{ display.takeaway }}</p>
      <div class="fc-minibars" *ngIf="display.score === null && display.blockScores.length">
        <div class="fc-minibar" *ngFor="let b of display.blockScores" [title]="b.heading + ': ' + b.score">
          <span class="fc-minibar-fill" [style.width.%]="b.score" [style.background]="color(b.score)"></span>
        </div>
      </div>
      <span class="fc-cta">Full analysis →</span>
    </a>
  `,
  styles: [`
    .fc-card { display:flex; flex-direction:column; gap:10px; background:var(--card);
      border:1px solid var(--border); border-radius:var(--r-lg); padding:18px 18px 16px;
      transition:border-color .2s, box-shadow .2s; }
    .fc-card:hover { border-color:var(--border-strong); box-shadow:var(--shadow); }
    .fc-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
    .fc-label { font-family:var(--font-display); font-size:1rem; font-weight:700;
      color:var(--text); line-height:1.3; }
    .fc-takeaway { font-size:0.84rem; line-height:1.6; color:var(--text-2); margin:0;
      display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .fc-minibars { display:flex; flex-direction:column; gap:4px; }
    .fc-minibar { height:6px; background:var(--bg-wash); border-radius:var(--r-sm);
      border:1px solid var(--border); overflow:hidden; }
    .fc-minibar-fill { display:block; height:100%; }
    .fc-cta { margin-top:auto; font-size:0.78rem; font-weight:600; color:var(--oxford); }
    .fc-card:hover .fc-cta { text-decoration:underline; }
  `],
})
export class FactorCardComponent implements OnChanges {
  @Input({ required: true }) factor!: FactorDef;
  @Input() ticker = '';
  @Input() blocks: SectionBlock[] | null = null;

  display: FactorDisplay = { score: null, sentiment: undefined, takeaway: null, blockScores: [] };

  ngOnChanges(): void {
    this.display = factorDisplay(this.blocks);
  }

  color(s: number): string {
    if (s >= 66) return 'var(--bull)';
    if (s >= 33) return 'var(--warn)';
    return 'var(--bear)';
  }
}
