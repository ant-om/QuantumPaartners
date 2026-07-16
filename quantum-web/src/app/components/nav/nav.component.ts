import { Component, HostListener } from '@angular/core';

@Component({
  selector: 'app-nav',
  standalone: false,
  template: `
    <header class="qp-nav" [class.qp-nav--scrolled]="scrolled">
      <div class="qp-nav-inner">
        <a routerLink="/" class="qp-brand" aria-label="Stock Bar home">
          <span class="qp-brand-symbol">▲</span>
          <span class="qp-brand-name">Stock<span class="qp-brand-dot">·</span>Bar</span>
        </a>
        <span class="qp-nav-tag qp-mono">
          <span class="qp-nav-pulse"></span>AI EQUITY INTELLIGENCE
        </span>
      </div>
    </header>
  `,
  styles: [`
    .qp-nav {
      position: fixed;
      top: var(--tape-h, 36px); left: 0; right: 0;
      z-index: 100;
      transition: background 0.3s, border-color 0.3s;
      border-bottom: 1px solid transparent;
    }
    .qp-nav--scrolled {
      background: rgba(251, 242, 231, 0.96);
      border-bottom-color: var(--border);
    }
    .qp-nav-inner {
      max-width: 1240px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .qp-nav-tag {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      font-size: 0.66rem;
      letter-spacing: 0.2em;
      color: var(--text-muted);
    }
    .qp-nav-pulse {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--claret);
    }
    @media (max-width: 560px) { .qp-nav-tag { display: none; } }
  `],
})
export class NavComponent {
  scrolled = false;

  @HostListener('window:scroll')
  onScroll(): void {
    this.scrolled = window.scrollY > 24;
  }
}
