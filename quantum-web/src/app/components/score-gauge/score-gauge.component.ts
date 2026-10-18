import { Component, Input } from '@angular/core';

/** Compact SVG arc gauge for a 0-100 score. Dependency-free. */
@Component({
  selector: 'app-score-gauge',
  standalone: false,
  template: `
    <div class="qp-gauge" *ngIf="score !== null && score !== undefined" [style.width.px]="size" [title]="label">
      <svg [attr.width]="size" [attr.height]="size" [attr.viewBox]="'0 0 ' + size + ' ' + size">
        <circle [attr.cx]="c" [attr.cy]="c" [attr.r]="r" fill="none" stroke="rgba(27, 35, 38,0.12)" [attr.stroke-width]="stroke" />
        <circle [attr.cx]="c" [attr.cy]="c" [attr.r]="r" fill="none" [attr.stroke]="color"
                [attr.stroke-width]="stroke" stroke-linecap="round"
                [attr.stroke-dasharray]="circumference"
                [attr.stroke-dashoffset]="offset"
                [attr.transform]="'rotate(-90 ' + c + ' ' + c + ')'" />
        <text [attr.x]="c" [attr.y]="c" text-anchor="middle" dominant-baseline="central"
              [attr.font-size]="size * 0.32" font-weight="700" fill="#1B2326"
              font-family="'IBM Plex Mono', monospace">{{ score }}</text>
      </svg>
      <span *ngIf="label" class="qp-gauge-label">{{ label }}</span>
    </div>
  `,
  styles: [`
    .qp-gauge { display:inline-flex; flex-direction:column; align-items:center; gap:5px; }
    .qp-gauge-label { font-family:var(--font-mono); font-size:0.62rem; font-weight:500;
      color:var(--text-muted); text-transform:uppercase; letter-spacing:0.1em; }
  `],
})
export class ScoreGaugeComponent {
  @Input() score?: number | null;
  @Input() label = '';
  @Input() size = 64;

  readonly stroke = 6;
  get c() { return this.size / 2; }
  get r() { return (this.size - this.stroke) / 2; }
  get circumference() { return 2 * Math.PI * this.r; }
  get offset() {
    const pct = Math.min(100, Math.max(0, this.score ?? 0)) / 100;
    return this.circumference * (1 - pct);
  }
  get color() {
    const s = this.score ?? 0;
    if (s >= 66) return '#3F7A4A';
    if (s >= 33) return '#B45309';
    return '#B3362C';
  }
}
