import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { trigger, state, style, animate, transition } from '@angular/animations';

@Component({
  selector: 'app-dynamic-island-toc',
  standalone: false,
  templateUrl: './dynamic-island-toc.component.html',
  styleUrl: './dynamic-island-toc.component.css',
  animations: [
    trigger('island', [
      state('collapsed', style({ width: '280px', height: '52px', borderRadius: '26px' })),
      state('expanded',  style({ width: '340px', height: '400px', borderRadius: '24px' })),
      transition('* <=> *', animate('500ms cubic-bezier(0.22, 1, 0.36, 1)')),
    ]),
    trigger('pillContent', [
      state('show', style({ opacity: 1, transform: 'scale(1)',    filter: 'blur(0px)' })),
      state('hide', style({ opacity: 0, transform: 'scale(0.95)', filter: 'blur(4px)' })),
      transition('* <=> *', animate('300ms ease')),
    ]),
    trigger('menuContent', [
      state('show', style({ opacity: 1, transform: 'scale(1)'    })),
      state('hide', style({ opacity: 0, transform: 'scale(1.05)' })),
      transition('* <=> *', animate('300ms ease')),
    ]),
    trigger('backdrop', [
      transition(':enter', [style({ opacity: 0 }), animate('400ms ease', style({ opacity: 1 }))]),
      transition(':leave', [animate('400ms ease', style({ opacity: 0 }))]),
    ]),
  ],
})
export class DynamicIslandTocComponent implements OnInit, OnDestroy {
  @Input() sections: { key: string; label: string }[] = [];
  @Input() sectionPrefix = 'section-';

  isExpanded = false;
  activeKey: string | null = null;
  hoveredKey: string | null = null;
  progress = 0;

  readonly svgSize = 24;
  readonly strokeWidth = 2.5;
  readonly radius = (24 - 2.5) / 2;
  readonly circumference = 2 * Math.PI * ((24 - 2.5) / 2);

  private scrollHandler = () => this.onScroll();

  get activeLabel(): string {
    return this.sections.find(s => s.key === this.activeKey)?.label ?? 'Contents';
  }

  get strokeOffset(): number {
    return this.circumference - (this.progress / 100) * this.circumference;
  }

  ngOnInit() {
    window.addEventListener('scroll', this.scrollHandler, { passive: true });
    this.onScroll();
  }

  ngOnDestroy() {
    window.removeEventListener('scroll', this.scrollHandler);
  }

  expand() {
    if (!this.isExpanded) this.isExpanded = true;
  }

  close() {
    this.isExpanded = false;
  }

  scrollTo(key: string) {
    const el = document.getElementById(this.sectionPrefix + key);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
    this.isExpanded = false;
  }

  private onScroll() {
    let current: string | null = null;
    for (const s of this.sections) {
      const el = document.getElementById(this.sectionPrefix + s.key);
      if (el && el.getBoundingClientRect().top <= 120) {
        current = s.key;
      }
    }
    if (current === null && this.sections.length > 0) {
      current = this.sections[0].key;
    }
    this.activeKey = current;

    const total = document.documentElement.scrollHeight - window.innerHeight;
    this.progress = total > 0
      ? Math.min(100, Math.max(0, (window.scrollY / total) * 100))
      : 0;
  }
}
