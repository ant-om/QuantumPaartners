import { Component, Input } from '@angular/core';
import { Sentiment } from '../../services/supabase.service';

@Component({
  selector: 'app-sentiment-chip',
  standalone: false,
  template: `
    <span *ngIf="sentiment" class="qp-chip" [class.pos]="sentiment === 'positive'"
          [class.neu]="sentiment === 'neutral'" [class.neg]="sentiment === 'negative'">
      <span class="qp-chip-dot"></span>{{ label }}
    </span>
  `,
  styles: [`
    .qp-chip { display:inline-flex; align-items:center; gap:6px; border-radius:var(--r-sm);
      padding:3px 11px; font-family:var(--font-mono); font-size:0.66rem; font-weight:500;
      letter-spacing:0.08em; text-transform:uppercase; border:1px solid transparent; }
    .qp-chip-dot { width:6px; height:6px; border-radius:50%; background:currentColor; }
    .pos { background:rgba(20,123,88,0.09); color:var(--bull); border-color:rgba(20,123,88,0.3); }
    .neu { background:var(--bg-wash); color:var(--text-2); border-color:var(--border); }
    .neg { background:rgba(168,30,30,0.07); color:var(--bear); border-color:rgba(168,30,30,0.28); }
  `],
})
export class SentimentChipComponent {
  @Input() sentiment?: Sentiment;

  get label(): string {
    return this.sentiment ? this.sentiment.charAt(0).toUpperCase() + this.sentiment.slice(1) : '';
  }
}
