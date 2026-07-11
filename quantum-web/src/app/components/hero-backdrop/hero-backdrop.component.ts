import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
} from '@angular/core';

interface P { x: number; y: number; vx: number; vy: number; }

/** Premium animated hero backdrop: aurora glow + faint grid + a drifting
 *  particle constellation on canvas. Runs outside Angular; respects
 *  prefers-reduced-motion and pauses when the tab is hidden. */
@Component({
  selector: 'app-hero-backdrop',
  standalone: false,
  template: `
    <div class="hb" aria-hidden="true">
      <div class="hb-aurora hb-a1"></div>
      <div class="hb-aurora hb-a2"></div>
      <div class="hb-grid"></div>
      <canvas #cv class="hb-canvas"></canvas>
      <div class="hb-vignette"></div>
    </div>
  `,
  styles: [`
    .hb { position: absolute; inset: 0; overflow: hidden; z-index: 0; }
    .hb-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

    .hb-aurora {
      position: absolute;
      border-radius: 50%;
      filter: blur(90px);
      opacity: 0.5;
      mix-blend-mode: screen;
    }
    .hb-a1 {
      width: 46vw; height: 46vw; top: -12vw; left: -6vw;
      background: radial-gradient(circle, rgba(52,211,153,0.55), transparent 65%);
      animation: drift1 22s ease-in-out infinite alternate;
    }
    .hb-a2 {
      width: 40vw; height: 40vw; bottom: -14vw; right: -8vw;
      background: radial-gradient(circle, rgba(34,211,238,0.42), transparent 65%);
      animation: drift2 26s ease-in-out infinite alternate;
    }
    @keyframes drift1 { from { transform: translate(0,0); } to { transform: translate(8vw, 6vw); } }
    @keyframes drift2 { from { transform: translate(0,0); } to { transform: translate(-7vw, -5vw); } }

    /* faint perspective grid */
    .hb-grid {
      position: absolute; inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px);
      background-size: 54px 54px;
      mask-image: radial-gradient(ellipse 70% 60% at 50% 35%, #000 30%, transparent 78%);
      -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 35%, #000 30%, transparent 78%);
    }

    /* fade the whole backdrop into the page below */
    .hb-vignette {
      position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(7,9,13,0.2) 0%, transparent 30%, rgba(7,9,13,0.85) 100%);
    }

    @media (prefers-reduced-motion: reduce) {
      .hb-aurora { animation: none; }
    }
  `],
})
export class HeroBackdropComponent implements AfterViewInit, OnDestroy {
  @ViewChild('cv') cv!: ElementRef<HTMLCanvasElement>;

  private ctx!: CanvasRenderingContext2D;
  private particles: P[] = [];
  private raf = 0;
  private ro?: ResizeObserver;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private reduced = false;
  private onVis = () => {
    if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; }
    else if (!this.raf && !this.reduced) { this.zone.runOutsideAngular(() => this.loop()); }
  };

  constructor(private host: ElementRef<HTMLElement>, private zone: NgZone) {}

  ngAfterViewInit(): void {
    const canvas = this.cv.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host.nativeElement);
    document.addEventListener('visibilitychange', this.onVis);

    if (this.reduced) { this.draw(); return; }
    this.zone.runOutsideAngular(() => this.loop());
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
  }

  private resize(): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    const canvas = this.cv.nativeElement;
    canvas.width = this.w * this.dpr;
    canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const target = Math.min(70, Math.round((this.w * this.h) / 22000));
    this.particles = Array.from({ length: target }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
    }));
    if (this.reduced) this.draw();
  }

  private loop = (): void => {
    this.step();
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private step(): void {
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > this.w) p.vx *= -1;
      if (p.y < 0 || p.y > this.h) p.vy *= -1;
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const ps = this.particles;
    const maxDist = 130;

    // connections
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const dx = ps[i].x - ps[j].x;
        const dy = ps[i].y - ps[j].y;
        const d = Math.hypot(dx, dy);
        if (d < maxDist) {
          const a = (1 - d / maxDist) * 0.18;
          ctx.strokeStyle = `rgba(120, 220, 200, ${a})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ps[i].x, ps[i].y);
          ctx.lineTo(ps[j].x, ps[j].y);
          ctx.stroke();
        }
      }
    }
    // nodes
    for (const p of ps) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(180, 240, 220, 0.55)';
      ctx.fill();
    }
  }
}
