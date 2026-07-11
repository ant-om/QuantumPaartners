import { Directive, ElementRef, Input, OnDestroy, OnInit, Renderer2 } from '@angular/core';

/** Adds a fade-up reveal when the element scrolls into view.
 *  Usage: <section appReveal [revealDelay]="80"> */
@Directive({
  selector: '[appReveal]',
  standalone: false,
})
export class RevealDirective implements OnInit, OnDestroy {
  @Input() revealDelay = 0;

  private io?: IntersectionObserver;

  constructor(private el: ElementRef<HTMLElement>, private r: Renderer2) {}

  ngOnInit(): void {
    const node = this.el.nativeElement;
    this.r.addClass(node, 'reveal');
    if (this.revealDelay) {
      this.r.setStyle(node, 'transition-delay', `${this.revealDelay}ms`);
    }

    if (typeof IntersectionObserver === 'undefined') {
      this.r.addClass(node, 'is-in');
      return;
    }

    this.io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            this.r.addClass(node, 'is-in');
            this.io?.unobserve(node);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    this.io.observe(node);
  }

  ngOnDestroy(): void {
    this.io?.disconnect();
  }
}
