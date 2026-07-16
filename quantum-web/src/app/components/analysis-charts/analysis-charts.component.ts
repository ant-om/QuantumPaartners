import { Component, Input, OnChanges } from '@angular/core';
import { StockAnalysis, SectionBlock, ScoreHistoryPoint } from '../../services/supabase.service';
import { FACTORS, factorDisplay } from '../../models/factors';

interface FactorBar { short: string; slug: string; score: number | null; }
interface MixRow { short: string; pos: number; neu: number; neg: number; total: number; }
interface TimelineSeries { key: string; label: string; points: string; color: string; }

/** Analysis-derived graphics: 7-factor score bars, sentiment mix, and the
 *  score-evolution timeline (hidden until >= 2 runs exist). All values read
 *  DIRECTLY from the analysis blocks — no synthetic averaging. */
@Component({
  selector: 'app-analysis-charts',
  standalone: false,
  template: `
    <div class="ac" *ngIf="analysis">
      <!-- 7-factor score bars -->
      <div class="qp-chart" *ngIf="factorBars.length">
        <div class="qp-chart-head"><span class="qp-chart-title">Factor scores</span></div>
        <div class="ac-bars">
          <a class="ac-bar-row" *ngFor="let b of factorBars"
             [routerLink]="['/stock', ticker, b.slug]">
            <span class="ac-bar-label">{{ b.short }}</span>
            <span class="ac-bar-track">
              <span *ngIf="b.score !== null" class="ac-bar-fill"
                    [style.width.%]="b.score" [style.background]="color(b.score)"></span>
            </span>
            <span class="ac-bar-score qp-mono">{{ b.score === null ? '—' : b.score }}</span>
          </a>
        </div>
      </div>

      <!-- Sentiment mix -->
      <div class="qp-chart" *ngIf="mixRows.length">
        <div class="qp-chart-head">
          <span class="qp-chart-title">Sentiment mix — analysis blocks per factor</span>
          <span class="qp-legend">
            <span class="qp-legend-item"><span class="qp-legend-dot" style="background:var(--bull)"></span>Positive</span>
            <span class="qp-legend-item"><span class="qp-legend-dot" style="background:var(--border-strong)"></span>Neutral</span>
            <span class="qp-legend-item"><span class="qp-legend-dot" style="background:var(--bear)"></span>Negative</span>
          </span>
        </div>
        <div class="ac-bars">
          <div class="ac-bar-row" *ngFor="let r of mixRows">
            <span class="ac-bar-label">{{ r.short }}</span>
            <span class="ac-mix-track">
              <span class="ac-mix-seg" [style.flex]="r.pos" style="background:var(--bull)"></span>
              <span class="ac-mix-seg" [style.flex]="r.neu" style="background:var(--border-strong)"></span>
              <span class="ac-mix-seg" [style.flex]="r.neg" style="background:var(--bear)"></span>
            </span>
            <span class="ac-bar-score qp-mono">{{ r.total }}</span>
          </div>
        </div>
      </div>

      <!-- Score evolution (needs >= 2 runs) -->
      <div class="qp-chart" *ngIf="timeline.length">
        <div class="qp-chart-head">
          <span class="qp-chart-title">Score evolution — {{ historyCount }} runs</span>
          <span class="qp-legend">
            <span class="qp-legend-item" *ngFor="let s of timeline">
              <span class="qp-legend-dot" [style.background]="s.color"></span>{{ s.label }}
            </span>
          </span>
        </div>
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" class="qp-svg">
          <line *ngFor="let t of yTicks" [attr.x1]="pad.l" [attr.x2]="W - pad.r"
                [attr.y1]="t.y" [attr.y2]="t.y" stroke="rgba(51,48,46,0.08)" />
          <text *ngFor="let t of yTicks" [attr.x]="pad.l - 6" [attr.y]="t.y + 3" text-anchor="end"
                font-size="10" fill="#8C847C" font-family="'JetBrains Mono', monospace">{{ t.label }}</text>
          <polyline *ngFor="let s of timeline" [attr.points]="s.points" fill="none"
                    [attr.stroke]="s.color" stroke-width="1.8" />
        </svg>
      </div>
    </div>
  `,
  styles: [`
    .ac-bars { display:flex; flex-direction:column; gap:7px; }
    .ac-bar-row { display:grid; grid-template-columns: 110px 1fr 34px; align-items:center; gap:12px; }
    a.ac-bar-row:hover .ac-bar-label { color:var(--claret); }
    .ac-bar-label { font-size:0.8rem; font-weight:500; color:var(--text-2); transition:color .15s; }
    .ac-bar-track { height:10px; background:var(--bg-wash); border-radius:var(--r-sm);
      overflow:hidden; border:1px solid var(--border); }
    .ac-bar-fill { display:block; height:100%; border-radius:var(--r-sm); }
    .ac-bar-score { font-size:0.78rem; font-weight:700; color:var(--text); text-align:right; }
    .ac-mix-track { display:flex; height:10px; border-radius:var(--r-sm); overflow:hidden;
      border:1px solid var(--border); background:var(--bg-wash); }
    .ac-mix-seg { display:block; height:100%; }
  `],
})
export class AnalysisChartsComponent implements OnChanges {
  @Input() analysis: StockAnalysis | null = null;
  @Input() ticker = '';
  @Input() history: ScoreHistoryPoint[] = [];

  readonly W = 680;
  readonly H = 190;
  readonly pad = { t: 12, r: 14, b: 14, l: 40 };

  factorBars: FactorBar[] = [];
  mixRows: MixRow[] = [];
  timeline: TimelineSeries[] = [];
  yTicks: { y: number; label: string }[] = [];
  historyCount = 0;

  ngOnChanges(): void {
    this.buildBars();
    this.buildMix();
    this.buildTimeline();
  }

  color(s: number): string {
    if (s >= 66) return 'var(--bull)';
    if (s >= 33) return 'var(--warn)';
    return 'var(--bear)';
  }

  private buildBars(): void {
    const a = this.analysis as unknown as Record<string, SectionBlock[] | null> | null;
    this.factorBars = !a ? [] : FACTORS.map(f => ({
      short: f.short, slug: f.slug, score: factorDisplay(a[f.key]).score,
    }));
    if (this.factorBars.every(b => b.score === null)) this.factorBars = [];
  }

  private buildMix(): void {
    const a = this.analysis as unknown as Record<string, SectionBlock[] | null> | null;
    this.mixRows = [];
    if (!a) return;
    for (const f of FACTORS) {
      const blocks = a[f.key] ?? [];
      if (!Array.isArray(blocks) || !blocks.length) continue;
      const pos = blocks.filter(b => b.sentiment === 'positive').length;
      const neg = blocks.filter(b => b.sentiment === 'negative').length;
      const neu = blocks.length - pos - neg;
      this.mixRows.push({ short: f.short, pos, neu, neg, total: blocks.length });
    }
    if (this.mixRows.every(r => r.pos + r.neg === 0)) this.mixRows = [];
  }

  private buildTimeline(): void {
    this.timeline = [];
    this.yTicks = [];
    const rows = this.history ?? [];
    this.historyCount = rows.length;
    if (rows.length < 2) return;

    const n = rows.length;
    const xAt = (i: number) => this.pad.l + (i / (n - 1)) * (this.W - this.pad.l - this.pad.r);
    const yAt = (v: number) => this.pad.t + (1 - v / 100) * (this.H - this.pad.t - this.pad.b);

    const series: { key: string; label: string; color: string }[] = [
      { key: 'summary_score', label: 'Overall', color: '#990F3D' },
      { key: 'price', label: 'Price', color: '#0F5499' },
      { key: 'financial', label: 'Financials', color: '#0D7680' },
      { key: 'sentiment', label: 'Sentiment', color: '#B45309' },
    ];
    for (const s of series) {
      const pts = rows
        .map((r, i) => ({ v: r[s.key] as number | null, i }))
        .filter(p => p.v !== null && p.v !== undefined && !isNaN(p.v as number));
      if (pts.length < 2) continue;
      this.timeline.push({
        key: s.key, label: s.label, color: s.color,
        points: pts.map(p => `${xAt(p.i).toFixed(1)},${yAt(p.v as number).toFixed(1)}`).join(' '),
      });
    }
    if (this.timeline.length) {
      for (let i = 0; i <= 4; i++) {
        const v = (i / 4) * 100;
        this.yTicks.push({ y: yAt(v), label: v.toFixed(0) });
      }
    }
  }
}
