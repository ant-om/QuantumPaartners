import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService, Stock, StockAnalysis, SectionBlock, ScoreHistoryPoint, AnalysisVerdict, HorizonStance, Sentiment, sectionProjection, sectionInsight, sectionChainRefs, sectionCertaintyText, r5CaseEvaluations, VerdictHistoryPoint } from '../../services/supabase.service';
import { SeoService } from '../../services/seo.service';
import { CitationIndex, EMPTY_CITATION_INDEX, annotateCitations, buildCitationIndex } from '../../services/citations';
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

  /** Terminal chart panel (Railway 30-day closes from `metrics`) with one
   *  marker per committee run — the approved instrument-card design.
   *  Null when the row has no price series (cell hides). */
  vhChart: {
    linePath: string; areaPath: string;
    dots: { x: number; y: number; latest: boolean; title: string }[];
    grid: { y: number; label: string }[];
    endLabel: { x: number; y: number; text: string };
    dateStart: string; dateEnd: string;
    chg: number;
    points: { x: number; y: number; date: string; close: number }[];
  } | null = null;

  /** Tape strip fields — computed once per load. */
  tape: { last: string; chg: string; runDate: string; streak: string } | null = null;

  /** Chart time range — 1M renders from the stored Railway series; longer
   *  ranges lazy-fetch our /api/history proxy once and slice sessions. */
  chartRange: '1M' | '3M' | '6M' | '1Y' = '1M';
  readonly chartRanges: ('1M' | '3M' | '6M' | '1Y')[] = ['1M', '3M', '6M', '1Y'];
  private fullHistory: { date: string; close: number }[] | null = null;
  chartHover: { x: number; y: number; price: string; priceW: number; date: string; dateX: number } | null = null;

  private metricsCloses(): { date: string; close: number }[] {
    return this.analysis?.metrics?.price?.last_30d_close ?? [];
  }

  async setRange(r: '1M' | '3M' | '6M' | '1Y'): Promise<void> {
    this.chartRange = r;
    this.chartHover = null;
    if (r === '1M') { this.buildVhChart(); return; }
    if (!this.fullHistory && this.stock) {
      this.fullHistory = await this.supabase.getPriceHistory(this.stock.ticker);
    }
    const rows = this.fullHistory ?? [];
    if (rows.length < 10) { this.chartRange = '1M'; this.buildVhChart(); return; }
    const n = r === '3M' ? 63 : r === '6M' ? 126 : 252;
    this.buildVhChart(rows.slice(-n));
  }

  onChartMove(e: MouseEvent): void {
    const c = this.vhChart;
    if (!c || !c.points.length) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * StockDetailComponent.VH_W;
    let best = c.points[0];
    for (const p of c.points) if (Math.abs(p.x - vx) < Math.abs(best.x - vx)) best = p;
    // Yahoo-style axis badges: price pill on the right axis at the point's
    // height, date pill under the x axis at the point's position.
    const price = `$${best.close.toFixed(2)}`;
    const priceW = price.length * 6.2 + 10;
    this.chartHover = {
      x: best.x,
      y: Math.min(Math.max(best.y, 23), 205),
      price, priceW,
      date: StockDetailComponent.monthDay(best.date),
      dateX: Math.min(Math.max(best.x, 34), 390),
    };
  }

  onChartLeave(): void {
    this.chartHover = null;
  }

  private static readonly VH_W = 470;
  private static readonly VH_H = 240;

  private static monthDay(iso: string): string {
    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const [, m, d] = iso.split('-').map(Number);
    return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`;
  }

  private buildVhChart(closesIn?: { date: string; close: number }[]): void {
    this.vhChart = null;
    const closes: { date: string; close: number }[] = closesIn ?? this.metricsCloses();
    const metrics = this.metricsCloses();
    const vh = this.verdictHistory;
    const rec = this.verdict?.recommendation;
    if (rec && vh.length && this.verdictStreak > 0 && !this.tape) {
      const streakRuns = vh.slice(vh.length - this.verdictStreak);
      this.tape = {
        last: metrics.length ? metrics[metrics.length - 1].close.toFixed(2) : '',
        chg: '',
        runDate: (this.analysis?.run_at ?? '').slice(0, 10),
        streak: `${rec} ×${this.verdictStreak} CONSECUTIVE · ${StockDetailComponent.monthDay(streakRuns[0].run_date)} → ${StockDetailComponent.monthDay(streakRuns[streakRuns.length - 1].run_date)}`,
      };
    }
    if (closes.length < 5) return;
    const W = StockDetailComponent.VH_W, H = StockDetailComponent.VH_H;
    const padL = 8, padR = 46, padT = 14, padB = 26;
    const lo = Math.min(...closes.map(c => c.close));
    const hi = Math.max(...closes.map(c => c.close));
    const x = (i: number) => padL + (i / (closes.length - 1)) * (W - padL - padR);
    const y = (v: number) => hi === lo ? H / 2 : padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const pts = closes.map((c, i) => ({ x: x(i), y: y(c.close) }));
    const linePath = this.smoothPath(pts);
    const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${H - padB + 4} L${pts[0].x.toFixed(1)},${H - padB + 4} Z`;
    const dots = vh.map((p, k) => {
      let idx = 0;
      for (let i = 0; i < closes.length; i++) if (closes[i].date <= p.run_date) idx = i;
      return {
        x: pts[idx].x, y: pts[idx].y, latest: k === vh.length - 1,
        title: `${p.run_date} — ${p.recommendation || '?'}${p.conviction ? ' · ' + p.conviction.toLowerCase() + ' conviction' : ''} · $${closes[idx].close.toFixed(2)}`,
      };
    });
    const grid = [hi, (hi + lo) / 2, lo].map(v => ({ y: y(v), label: `$${v.toFixed(0)}` }));
    const last = closes[closes.length - 1];
    const chg = (last.close / closes[0].close - 1) * 100;
    this.vhChart = {
      linePath, areaPath, dots, grid,
      endLabel: { x: pts[pts.length - 1].x - 10, y: pts[pts.length - 1].y - 11, text: last.close.toFixed(2) },
      dateStart: StockDetailComponent.monthDay(closes[0].date),
      dateEnd: StockDetailComponent.monthDay(last.date),
      chg,
      points: closes.map((c, i) => ({ x: pts[i].x, y: pts[i].y, date: c.date, close: c.close })),
    };
    if (this.tape && !this.tape.chg && closesIn === undefined) {
      this.tape.chg = `${chg < 0 ? '▼' : '▲'}${Math.abs(chg).toFixed(1)}%`;
    }
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
  loading = true;
  notFound = false;
  aboutOpen = false;

  /** Inline-citation numbering for this page. Computed ONCE per load, before
   *  first render, so numbers never shuffle mid-render (and never trip
   *  ExpressionChangedAfterItHasBeenChecked). Empty index = zero citations
   *  anywhere, and the page renders exactly as it did before. */
  citations: CitationIndex = EMPTY_CITATION_INDEX;

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
   *  never the literal asterisks. Escaped first, so only our <b> and the
   *  citation markers survive. */
  bulletHtml(b: string): string {
    const html = b
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/[*_`]+/g, '');
    return annotateCitations(html, this.citations);
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
      if (this.citations.entries.length) toc.push({ key: 'references', label: 'References' });
    }
    return toc;
  }

  /** Every piece of model prose on this page, in DOM order — the input to the
   *  citation numbering, which is by first appearance. Includes ALL factor
   *  tabs, not just the open one: numbers must not shuffle when a reader
   *  switches tabs, and the References list is the whole page's. */
  private citationTexts(): (string | null | undefined)[] {
    const texts: (string | null | undefined)[] = [];
    const sum = this.analysis?.summary;
    if (sum) {
      texts.push(sum.headline, sum.narrative);
      for (const h of this.horizonRows) texts.push(h.rationale);
      for (const b of sum.bullets ?? []) texts.push(b);
      for (const ov of this.otherViews) texts.push(ov.text);
    }
    for (const f of this.presentFactors) {
      for (const t of this.takeaways(f.key)) {
        texts.push(t.certaintyText, t.takeaway, t.insight);
      }
    }
    return texts;
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
    // Citations are optional: getCitationRefs returns {} on any failure, and an
    // empty index makes every render path below a no-op.
    this.citations = buildCitationIndex(
      this.citationTexts(),
      await this.supabase.getCitationRefs(this.stock.ticker, this.analysis?.run_at ?? null),
    );
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
