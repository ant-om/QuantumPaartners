import { Component, Input, OnChanges } from '@angular/core';
import { Metrics } from '../../services/supabase.service';

interface Line { points: string; color: string; label: string; dash?: boolean; }
interface Stat { label: string; value: string; tone?: 'pos' | 'neg' | 'neu'; }
interface RefLine { y: number; color: string; label: string; }

/** Dependency-free SVG charts driven by the live Railway quant API shape
 *  (GET /analyze/<ticker>) stored in the `metrics` JSONB column. */
@Component({
  selector: 'app-metric-charts',
  standalone: false,
  templateUrl: './metric-charts.component.html',
  styleUrls: ['./metric-charts.component.css'],
})
export class MetricChartsComponent implements OnChanges {
  @Input() metrics: Metrics | null = null;

  readonly W = 680;
  readonly H = 220;
  readonly pad = { t: 12, r: 14, b: 22, l: 50 };

  stats: Stat[] = [];

  // Price chart
  hasPrice = false;
  priceLine: Line | null = null;
  priceRefs: RefLine[] = [];
  bollinger: { top: number; bottom: number } | null = null;
  priceYTicks: { y: number; label: string }[] = [];

  // Monte Carlo range bar
  hasMc = false;
  mc = { lowerX: 0, upperX: 0, meanX: 0, lastX: 0, lower: 0, upper: 0, mean: 0, last: 0, horizon: 0, ret: 0 };
  readonly barW = 680;
  readonly barH = 88;

  // VIX chart
  hasVix = false;
  vixLine: Line | null = null;
  vixYTicks: { y: number; label: string }[] = [];

  ngOnChanges(): void {
    this.buildStats();
    this.buildPrice();
    this.buildMonteCarlo();
    this.buildVix();
  }

  private f(n: number | undefined | null, d = 2): string {
    return (n === undefined || n === null || isNaN(n as number)) ? '—' : (n as number).toFixed(d);
  }
  private pct(n: number | undefined | null, d = 1): string {
    return (n === undefined || n === null) ? '—' : `${(n as number).toFixed(d)}%`;
  }

  private buildStats(): void {
    const m = this.metrics;
    this.stats = [];
    if (!m) return;

    if (m.price) this.stats.push({ label: 'Last close', value: `$${this.f(m.price.last_close)}` });
    if (m.volatility) this.stats.push({ label: 'Ann. volatility', value: this.pct(m.volatility.annualized_volatility * 100) });
    if (m.returns) this.stats.push({
      label: 'Sharpe (ann.)', value: this.f(m.returns.sharpe_daily_annualized),
      tone: (m.returns.sharpe_daily_annualized ?? 0) >= 1 ? 'pos' : 'neu',
    });
    if (m.technicals?.RSI) this.stats.push({
      label: 'RSI (14)', value: `${this.f(m.technicals.RSI.RSI_14_last, 1)} · ${m.technicals.RSI.RSI_14_state}`,
      tone: m.technicals.RSI.RSI_14_last >= 70 ? 'neg' : m.technicals.RSI.RSI_14_last <= 30 ? 'pos' : 'neu',
    });
    if (m.VaR) {
      this.stats.push({ label: 'VaR 95% (daily)', value: this.pct(m.VaR.VaR_5pct_daily * 100), tone: 'neg' });
      this.stats.push({ label: 'VaR 99% (daily)', value: this.pct(m.VaR.VaR_1pct_daily * 100), tone: 'neg' });
    }
    if (m.drawdown) this.stats.push({ label: 'Max drawdown', value: this.pct(m.drawdown.max_drawdown * 100), tone: 'neg' });
    if (m.factor_model) {
      this.stats.push({ label: 'Beta (CAPM)', value: this.f(m.factor_model.capm_beta_univariate_60m) });
      this.stats.push({ label: 'FF α (ann.)', value: this.pct(m.factor_model.fama_french_alpha_annual * 100),
        tone: (m.factor_model.fama_french_alpha_annual ?? 0) >= 0 ? 'pos' : 'neg' });
    }
    if (m.technicals?.MACD) this.stats.push({
      label: 'MACD', value: m.technicals.MACD.crossover,
      tone: m.technicals.MACD.crossover === 'bullish' ? 'pos' : m.technicals.MACD.crossover === 'bearish' ? 'neg' : 'neu',
    });
    if (m.technicals?.golden_death_cross) this.stats.push({
      label: 'MA cross', value: m.technicals.golden_death_cross.current_state,
      tone: m.technicals.golden_death_cross.current_state === 'golden' ? 'pos' : 'neg',
    });
    if (m.garch_model) this.stats.push({ label: 'GARCH persistence', value: this.f(m.garch_model.persistence) });
    if (m.vix_levels) this.stats.push({ label: 'VIX', value: this.f(m.vix_levels.vix_level_last, 1) });
  }

  private buildPrice(): void {
    this.hasPrice = false;
    const hist = this.metrics?.price?.last_30d_close;
    const t = this.metrics?.technicals;
    if (!hist || hist.length < 2) return;

    const closes = hist.map(p => p.close);
    const bb = t?.bollinger_bands;
    const refVals: number[] = [];
    if (bb) refVals.push(bb.upper, bb.lower);
    if (t) refVals.push(t.SMA_50_last, t.SMA_200_last);
    let lo = Math.min(...closes, ...refVals);
    let hi = Math.max(...closes, ...refVals);
    if (lo === hi) hi = lo + 1;
    const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;

    const n = hist.length;
    const xAt = (i: number) => this.pad.l + (i / (n - 1)) * (this.W - this.pad.l - this.pad.r);
    const yAt = (v: number) => this.pad.t + (1 - (v - lo) / (hi - lo)) * (this.H - this.pad.t - this.pad.b);

    this.priceLine = { points: hist.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.close).toFixed(1)}`).join(' '), color: '#6366f1', label: 'Close (30d)' };

    this.bollinger = bb ? { top: yAt(bb.upper), bottom: yAt(bb.lower) } : null;
    this.priceRefs = [];
    if (t) {
      this.priceRefs.push({ y: yAt(t.SMA_50_last), color: '#10b981', label: 'SMA 50' });
      this.priceRefs.push({ y: yAt(t.SMA_200_last), color: '#94a3b8', label: 'SMA 200' });
    }
    this.priceYTicks = this.ticks(lo, hi, yAt, v => `$${v.toFixed(0)}`);
    this.hasPrice = true;
  }

  private buildMonteCarlo(): void {
    this.hasMc = false;
    const mc = this.metrics?.monte_carlo;
    const last = this.metrics?.price?.last_close;
    if (!mc || last == null) return;

    const lo = Math.min(mc.ci_95_lower, last);
    const hi = Math.max(mc.ci_95_upper, last);
    const span = hi - lo || 1;
    const left = 60, right = this.barW - 60;
    const xAt = (v: number) => left + ((v - lo) / span) * (right - left);

    this.mc = {
      lowerX: xAt(mc.ci_95_lower), upperX: xAt(mc.ci_95_upper),
      meanX: xAt(mc.mean_price), lastX: xAt(last),
      lower: mc.ci_95_lower, upper: mc.ci_95_upper, mean: mc.mean_price, last,
      horizon: mc.horizon_days, ret: mc.potential_return_pct,
    };
    this.hasMc = true;
  }

  private buildVix(): void {
    this.hasVix = false;
    const series = this.metrics?.vix_levels?.vix_last_30d;
    if (!series || series.length < 2) return;
    const vals = series.map(p => p.vix);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) hi = lo + 1;
    const padY = (hi - lo) * 0.1; lo -= padY; hi += padY;
    const n = series.length, h = 150;
    const xAt = (i: number) => this.pad.l + (i / (n - 1)) * (this.W - this.pad.l - this.pad.r);
    const yAt = (v: number) => this.pad.t + (1 - (v - lo) / (hi - lo)) * (h - this.pad.t - this.pad.b);
    this.vixLine = { points: series.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.vix).toFixed(1)}`).join(' '), color: '#a855f7', label: 'VIX (30d)' };
    this.vixYTicks = this.ticks(lo, hi, yAt, v => v.toFixed(0));
    this.hasVix = true;
  }

  private ticks(lo: number, hi: number, yAt: (v: number) => number, fmt: (v: number) => string) {
    const out = [];
    for (let i = 0; i <= 4; i++) { const v = lo + (i / 4) * (hi - lo); out.push({ y: yAt(v), label: fmt(v) }); }
    return out;
  }
}
