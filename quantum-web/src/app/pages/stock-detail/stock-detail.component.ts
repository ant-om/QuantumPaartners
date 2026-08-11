import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService, Stock, StockAnalysis, SectionBlock, ScoreHistoryPoint, AnalysisVerdict, HorizonStance, Sentiment, sectionProjection, sectionInsight, sectionChainRefs, sectionCertaintyText, r5CaseEvaluations, VerdictHistoryPoint } from '../../services/supabase.service';
import { SeoService } from '../../services/seo.service';
import { CHAIN_TOPICS, FACTORS, FactorDef, factorDisplay } from '../../models/factors';

@Component({
  selector: 'app-stock-detail',
  standalone: false,
  templateUrl: './stock-detail.component.html',
  styleUrl: './stock-detail.component.css'
})
export class StockDetailComponent implements OnInit {
  stock: Stock | null = null;
  analysis: StockAnalysis | null = null;
  history: ScoreHistoryPoint[] = [];
  verdictHistory: VerdictHistoryPoint[] = [];
  verdictStreak = 0;

  get streakStart(): string | null {
    if (!this.verdictStreak) return null;
    return this.verdictHistory[this.verdictHistory.length - this.verdictStreak]?.run_date ?? null;
  }

  /** Price chart (Railway 30-day closes from `metrics`) with one marker per
   *  committee run, colored by its verdict — the calls plotted on the tape.
   *  Smooth line + gradient area + price grid + hover crosshair.
   *  Null when the row has no price series; the plain cell strip renders then. */
  vhChart: {
    linePath: string; areaPath: string;
    dots: { x: number; y: number; cls: string; title: string }[];
    grid: { y: number; label: string }[];
    points: { x: number; y: number; date: string; close: number }[];
    lastLabel: string; lastX: number; lastY: number;
    startDate: string; endDate: string;
  } | null = null;
  chartHover: { x: number; y: number; label: string; anchor: 'start' | 'end' } | null = null;

  private static readonly VH_W = 560;
  private static readonly VH_H = 150;

  private buildVhChart(): void {
    this.vhChart = null;
    const closes: { date: string; close: number }[] = this.analysis?.metrics?.price?.last_30d_close ?? [];
    if (closes.length < 5 || this.verdictHistory.length < 2) return;
    const W = StockDetailComponent.VH_W, H = StockDetailComponent.VH_H;
    const padL = 6, padR = 54, padT = 14, padB = 12;
    const lo = Math.min(...closes.map(c => c.close));
    const hi = Math.max(...closes.map(c => c.close));
    const x = (i: number) => padL + (i / (closes.length - 1)) * (W - padL - padR);
    const y = (v: number) => hi === lo ? H / 2 : padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const points = closes.map((c, i) => ({ x: x(i), y: y(c.close), date: c.date, close: c.close }));
    const linePath = this.smoothPath(points);
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${H - 2} L${points[0].x.toFixed(1)},${H - 2} Z`;
    const dots = this.verdictHistory.map(p => {
      let idx = -1;
      for (let i = 0; i < closes.length; i++) if (closes[i].date <= p.run_date) idx = i;
      if (idx < 0) idx = 0;
      return {
        x: points[idx].x, y: points[idx].y,
        cls: (p.recommendation || 'hold').toLowerCase(),
        title: `${p.run_date} — ${p.recommendation || '?'}${p.conviction ? ' · ' + p.conviction.toLowerCase() + ' conviction' : ''} · $${closes[idx].close.toFixed(0)}`,
      };
    });
    const grid = [hi, (hi + lo) / 2, lo].map(v => ({ y: y(v), label: `$${v.toFixed(0)}` }));
    const last = closes[closes.length - 1];
    this.vhChart = {
      linePath, areaPath, dots, grid, points,
      lastLabel: `$${last.close.toFixed(0)}`,
      lastX: x(closes.length - 1), lastY: y(last.close),
      startDate: closes[0].date, endDate: last.date,
    };
  }

  /** Catmull-Rom → cubic Bézier, the standard smooth financial line. */
  private smoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }

  onChartMove(e: MouseEvent): void {
    const c = this.vhChart;
    if (!c) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * StockDetailComponent.VH_W;
    let best = c.points[0];
    for (const p of c.points) if (Math.abs(p.x - vx) < Math.abs(best.x - vx)) best = p;
    const d = new Date(best.date + 'T00:00:00');
    const label = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · $${best.close.toFixed(0)}`;
    this.chartHover = { x: best.x, y: best.y, label, anchor: best.x > StockDetailComponent.VH_W * 0.7 ? 'end' : 'start' };
  }

  onChartLeave(): void {
    this.chartHover = null;
  }
  loading = true;
  notFound = false;
  aboutOpen = false;

  /** Per-factor conclusion sentiment for the section-header chips — computed once per load. */
  factorSentiments: Record<string, Sentiment | undefined> = {};

  /** Factors with conclusions, split into two height-balanced columns.
   *  Explicit columns instead of CSS multicol — Chrome clips/bleeds cards
   *  with break-inside:avoid in a multicol flow. */
  /** Factors that have conclusions — the tab strip. */
  presentFactors: FactorDef[] = [];
  activeFactorKey = '';

  readonly factors: FactorDef[] = FACTORS;

  /** R5 committee verdict — present only on new-structurer rows. Strictly
   *  feature-detected: anything malformed falls back to the legacy gauge. */
  get verdict(): AnalysisVerdict | null {
    const v = this.analysis?.summary?.verdict;
    if (!v || !['BUY', 'HOLD', 'SELL'].includes(v.recommendation)) return null;
    return v;
  }

  /** "Committee view | The other side" toggle on the summary card. Under a
   *  directional verdict only the OPPOSITE case appears (the aligned case IS
   *  the narrative); a HOLD shows both. Empty on legacy rows. */
  summaryView: 'committee' | 'bull' | 'bear' = 'committee';
  otherViews: { key: 'bull' | 'bear'; label: string; text: string }[] = [];

  private buildOtherViews(): void {
    this.summaryView = 'committee';
    this.otherViews = [];
    const cases = r5CaseEvaluations(this.analysis?.r5_synthesis);
    const rec = this.verdict?.recommendation;
    if (rec === 'SELL' && cases.bull) {
      this.otherViews.push({ key: 'bull', label: 'The other side', text: cases.bull });
    } else if (rec === 'BUY' && cases.bear) {
      this.otherViews.push({ key: 'bear', label: 'The other side', text: cases.bear });
    } else if (rec === 'HOLD') {
      if (cases.bull) this.otherViews.push({ key: 'bull', label: 'Bull case', text: cases.bull });
      if (cases.bear) this.otherViews.push({ key: 'bear', label: 'Bear case', text: cases.bear });
    }
  }

  /** Risk bullets carry a bold lead phrase as markdown — render the bold,
   *  never the literal asterisks. Escaped first, so only our <b> survives. */
  bulletHtml(b: string): string {
    return b
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/[*_`]+/g, '');
  }

  /** Horizon strip rows (Short / Medium / Long), skipping absent horizons.
   *  Computed once per analysis load — not a getter, to keep *ngFor stable. */
  horizonRows: { label: string; range: string; stance: HorizonStance; rationale: string }[] = [];

  private buildHorizonRows(): void {
    const h = this.verdict?.horizons;
    if (!h) { this.horizonRows = []; return; }
    const defs: { key: 'short' | 'medium' | 'long'; label: string; range: string }[] = [
      { key: 'short', label: 'Short', range: '0–3 mo' },
      { key: 'medium', label: 'Medium', range: '3–12 mo' },
      { key: 'long', label: 'Long', range: '12+ mo' },
    ];
    this.horizonRows = defs
      .filter(d => !!h[d.key]?.stance)
      .map(d => ({ label: d.label, range: d.range, stance: h[d.key]!.stance, rationale: h[d.key]!.rationale ?? '' }));
  }

  // TOC entries — anchors match the section ids in the template
  get tocSections() {
    const toc = [{ key: 'summary', label: 'Overview' }];
    if (this.analysis) {
      if (this.history.length >= 2) toc.push({ key: 'charts', label: 'Score evolution' });
      toc.push({ key: 'factors', label: 'The seven factors' });
    }
    return toc;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private supabase: SupabaseService,
    private seo: SeoService
  ) {}

  async ngOnInit() {
    const ticker = this.route.snapshot.paramMap.get('ticker') ?? '';
    this.stock = await this.supabase.getStockByTicker(ticker);
    if (!this.stock) {
      this.notFound = true;
      this.loading = false;
      this.seo.set({ title: 'Stock not found', noindex: true });
      return;
    }
    this.analysis = await this.supabase.getAnalysis(this.stock.id);
    this.buildHorizonRows();
    this.buildOtherViews();
    for (const f of this.factors) this.factorSentiments[f.key] = factorDisplay(this.blocks(f.key)).sentiment;
    this.presentFactors = this.factors.filter(f => this.takeaways(f.key).length);
    this.activeFactorKey = this.presentFactors[0]?.key ?? '';
    this.loading = false;
    this.seo.set({
      title: `${this.stock.ticker} Stock Analysis & AI Score — ${this.stock.name}`,
      description: this.analysis?.summary?.headline
        ?? `AI analysis of ${this.stock.name} (${this.stock.ticker}) across seven factors, updated daily.`,
      canonicalPath: `/stock/${this.stock.ticker}`,
      ogType: 'article',
      jsonLd: {
        '@context': 'https://schema.org', '@type': 'Article',
        headline: this.analysis?.summary?.headline ?? `${this.stock.ticker} AI stock analysis`,
        about: { '@type': 'Corporation', name: this.stock.name, tickerSymbol: this.stock.ticker },
        dateModified: this.analysis?.run_at, author: { '@type': 'Organization', name: 'Stock Bar' },
      },
    });
    // score history is optional (view may not exist yet) — never blocks render
    this.history = await this.supabase.getScoreHistory(this.stock.id);
    this.verdictHistory = await this.supabase.getVerdictHistory(this.stock.ticker);
    const vh = this.verdictHistory;
    const last = vh[vh.length - 1]?.recommendation ?? null;
    let n = 0;
    for (let i = vh.length - 1; i >= 0 && last && vh[i].recommendation === last; i--) n++;
    this.verdictStreak = n;
    this.buildVhChart();
  }

  blocks(key: string): SectionBlock[] | null {
    return (this.analysis as any)?.[key] ?? null;
  }

  takeaways(key: string): { heading: string; takeaway: string; insight: string | null; refs: number[]; score: number | null; certainty: number | null; certaintyText: string | null }[] {
    return (this.blocks(key) ?? [])
      .filter(b => b.takeaway)
      .map(b => ({
        heading: b.heading,
        // full Projection paragraph when the body has one; legacy rows keep the stored one-liner
        takeaway: sectionProjection(b) ?? b.takeaway,
        insight: sectionInsight(b),
        refs: sectionChainRefs(b),
        score: b.score ?? null,
        certainty: b.certainty ?? null,
        certaintyText: sectionCertaintyText(b),
      }));
  }

  /** Citation label for a chain the section names as its source —
   *  "Chain 2 · Balance Sheet" when the module's topic registry covers it. */
  chainRefLabel(f: FactorDef, r: number): string {
    const topics = CHAIN_TOPICS[f.module];
    // last registry entry is the conclusion itself, not a numbered chain
    const topic = topics && r <= topics.length - 1 ? topics[r - 1] : null;
    return topic ? `Chain ${r} · ${topic}` : `Chain ${r}`;
  }

  /** Conclusion scores are 0-100 bullishness — surface them as stance words
   *  (the Horizons vocabulary), not bare numbers. Exact score stays on hover. */
  scoreStance(s: number): { label: string; band: string } {
    if (s >= 70) return { label: 'Bullish', band: 'bull' };
    if (s >= 55) return { label: 'Leans bullish', band: 'lean-bull' };
    if (s >= 45) return { label: 'Neutral', band: 'neutral' };
    if (s >= 30) return { label: 'Leans bearish', band: 'lean-bear' };
    return { label: 'Bearish', band: 'bear' };
  }

  dotColor(key: string): string {
    const s = this.factorSentiments[key];
    return s === 'positive' ? 'var(--bull)' : s === 'negative' ? 'var(--bear)' : 'var(--text-muted)';
  }

  setTab(key: string) {
    this.activeFactorKey = key;
  }

  goHome() {
    this.router.navigate(['/']);
  }
}
