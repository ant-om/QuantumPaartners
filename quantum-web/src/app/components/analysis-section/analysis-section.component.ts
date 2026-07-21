import { Component, Input } from '@angular/core';
import { SectionBlock } from '../../services/supabase.service';

/** Renders one analysis section (e.g. "Macroeconomic Environment") as a stack
 *  of cards — one per SectionBlock. Replaces the old single text blob. */
@Component({
  selector: 'app-analysis-section',
  standalone: false,
  template: `
    <div class="qp-asec" [id]="'section-' + key">
      <h2 class="qp-section-heading">{{ label }}</h2>

      <ng-container *ngIf="blocks && blocks.length; else noData">
        <div *ngFor="let b of blocks" class="qp-card">
          <div class="qp-card-head">
            <h3 class="qp-card-title">{{ b.heading }}</h3>
            <div class="qp-card-meta">
              <app-sentiment-chip [sentiment]="b.sentiment"></app-sentiment-chip>
              <app-score-gauge *ngIf="b.score !== undefined && b.score !== null"
                               [score]="b.score" [size]="48"></app-score-gauge>
            </div>
          </div>
          <p *ngIf="b.takeaway" class="qp-card-takeaway">{{ b.takeaway }}</p>
          <div *ngIf="b.body" class="qp-card-body qp-md"
               [innerHTML]="b.body | md : ticker : key"></div>
          <ul *ngIf="b.bullets && b.bullets.length" class="qp-card-bullets">
            <li *ngFor="let pt of b.bullets">{{ pt }}</li>
          </ul>
        </div>
      </ng-container>

      <ng-template #noData>
        <p class="qp-nodata">No data available.</p>
      </ng-template>
    </div>
  `,
  styles: [`
    .qp-asec { margin-top: 44px; }
    .qp-card { border:1px solid var(--border); border-radius:var(--r-md); padding:20px 22px;
      margin-bottom:14px; background:var(--surface);
      transition:border-color .25s, background .25s; }
    .qp-card:hover { border-color:var(--border-strong); background:var(--surface-2); }
    .qp-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; }
    .qp-card-title { font-family:var(--font-display); font-size:1.05rem; font-weight:600;
      color:var(--text); margin:0 0 2px; letter-spacing:-0.01em; }
    .qp-card-meta { display:flex; align-items:center; gap:12px; flex-shrink:0; }
    .qp-card-takeaway { font-size:0.96rem; font-weight:600; color:var(--text); margin:8px 0 8px;
      line-height:1.55; }
    .qp-card-body { font-size:0.92rem; line-height:1.8; color:var(--text-2); margin:0;
      max-width:65ch; text-wrap:pretty; }
    .qp-card-bullets { margin:12px 0 0; padding-left:18px; }
    .qp-card-bullets li { font-size:0.9rem; line-height:1.7; color:var(--text-2); }
    .qp-card-bullets li::marker { color:var(--accent); }
    .qp-nodata { color:var(--text-muted); font-style:italic; font-size:0.88rem; }
  `],
})
export class AnalysisSectionComponent {
  @Input() key = '';
  @Input() label = '';
  @Input() blocks: SectionBlock[] | null = null;
  /** Enables factor cross-links in block bodies; `key` doubles as the
   *  current-factor slug (key === slug for all 7 factors) so a section
   *  never links to itself. Empty ticker → markdown render only. */
  @Input() ticker = '';
}
