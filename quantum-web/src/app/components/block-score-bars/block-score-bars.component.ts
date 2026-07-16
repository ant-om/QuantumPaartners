import { Component, Input } from '@angular/core';
import { SectionBlock } from '../../services/supabase.service';

/** Per-block score bars — heading, score bar, sentiment chip. Works for factors
 *  with no quant data (Political / Management / Competitor). Direct values only. */
@Component({
  selector: 'app-block-score-bars',
  standalone: false,
  template: `
    <div class="bsb" *ngIf="rows.length">
      <div class="bsb-row" *ngFor="let r of rows">
        <span class="bsb-heading">{{ r.heading }}</span>
        <span class="bsb-track">
          <span class="bsb-fill" [style.width.%]="r.score" [style.background]="color(r.score)"></span>
        </span>
        <span class="bsb-score qp-mono">{{ r.score }}</span>
        <app-sentiment-chip [sentiment]="r.sentiment"></app-sentiment-chip>
      </div>
    </div>
  `,
  styles: [`
    .bsb { display:flex; flex-direction:column; gap:8px; }
    .bsb-row { display:grid; grid-template-columns: minmax(120px, 220px) 1fr 34px auto;
      align-items:center; gap:12px; }
    .bsb-heading { font-size:0.8rem; font-weight:500; color:var(--text-2); white-space:nowrap;
      overflow:hidden; text-overflow:ellipsis; }
    .bsb-track { height:8px; background:var(--bg-wash); border-radius:var(--r-sm);
      overflow:hidden; border:1px solid var(--border); }
    .bsb-fill { display:block; height:100%; border-radius:var(--r-sm); }
    .bsb-score { font-size:0.78rem; font-weight:700; color:var(--text); text-align:right; }
    @media (max-width: 560px) { .bsb-row { grid-template-columns: 1fr 60px 30px; }
      .bsb-row app-sentiment-chip { display:none; } }
  `],
})
export class BlockScoreBarsComponent {
  @Input() blocks: SectionBlock[] | null = null;

  get rows() {
    return (this.blocks ?? [])
      .filter(b => b.score !== undefined && b.score !== null)
      .map(b => ({ heading: b.heading, score: b.score as number, sentiment: b.sentiment }));
  }

  color(s: number): string {
    if (s >= 66) return 'var(--bull)';
    if (s >= 33) return 'var(--warn)';
    return 'var(--bear)';
  }
}
