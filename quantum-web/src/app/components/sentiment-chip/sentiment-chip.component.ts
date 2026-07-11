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
    .qp-chip { display:inline-flex; align-items:center; gap:6px; border-radius:999px;
      padding:3px 11px; font-family:var(--font-mono); font-size:0.66rem; font-weight:500;
      letter-spacing:0.08em; text-transform:uppercase; border:1px solid transparent; }
    .qp-chip-dot { width:6px; height:6px; border-radius:50%; background:currentColor;
      box-shadow:0 0 8px currentColor; }
    .pos { background:rgba(52,211,153,0.12); color:#34d399; border-color:rgba(52,211,153,0.25); }
    .neu { background:rgba(255,255,255,0.06); color:#a7b0bf; border-color:rgba(255,255,255,0.12); }
    .neg { background:rgba(248,113,113,0.12); color:#f87171; border-color:rgba(248,113,113,0.25); }
  `],
})
export class SentimentChipComponent {
  @Input() sentiment?: Sentiment;

  get label(): string {
    return this.sentiment ? this.sentiment.charAt(0).toUpperCase() + this.sentiment.slice(1) : '';
  }
}
