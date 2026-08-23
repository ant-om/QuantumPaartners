import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Directive, HostListener, Inject, NgZone, OnDestroy, PLATFORM_ID } from '@angular/core';
import { citationAnchorTarget } from '../services/citations';

/** Added to a References entry for a moment after a marker jumps to it, so the
 *  reader sees where they landed. Styled in ReferencesComponent. */
const FLASH_CLASS = 'qp-ref-flash';
const FLASH_MS = 1600;

/**
 * Makes an inline citation marker scroll to its References entry instead of
 * navigating away.
 *
 * Usage: put it on the element that CONTAINS both the analysis prose and the
 * References list — `<article class="qp-article" appCitationScroll>` on the
 * stock and factor pages. One delegated listener per page: the markers are
 * injected through [innerHTML] by the `md` / `cite` pipes, so they are plain
 * `<a href="#qp-ref-3">` nodes with no Angular binding of their own and there
 * is nothing to attach a per-marker handler to.
 *
 * Why it is needed at all: `src/index.html` sets `<base href="/">`, so the
 * browser resolves a bare fragment against the BASE url rather than the current
 * route. From /stock/TSLA/management a click on `#qp-ref-3` went to
 * `/#qp-ref-3` → the `''` route → the home page. The router's
 * `anchorScrolling: 'enabled'` never applied because these anchors are raw HTML,
 * not routerLinks.
 *
 * The handler: matches only anchors whose fragment is ours
 * (citationAnchorTarget), cancels the navigation, scrolls the entry into view,
 * moves keyboard focus onto it, and rewrites the address bar with
 * `history.replaceState` — replace, not push, so the back button still goes to
 * the page the reader came from and not through a pile of fragment steps.
 *
 * SSR-safe: the listener is registered by Angular but a click can only happen
 * in a browser, and every DOM/window access below still sits behind an explicit
 * platform check so prerendering can never touch it.
 */
@Directive({
  selector: '[appCitationScroll]',
  standalone: false,
})
export class CitationScrollDirective implements OnDestroy {
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private flashed: HTMLElement | null = null;

  constructor(
    @Inject(DOCUMENT) private doc: Document,
    @Inject(PLATFORM_ID) private platformId: object,
    private zone: NgZone,
  ) {}

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    if (!isPlatformBrowser(this.platformId) || event.defaultPrevented) return;

    // Modifier-clicks are intercepted too: opening `#qp-ref-3` in a new tab
    // would land on the home page, which is the very bug being fixed.
    const anchor = (event.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null;
    if (!anchor) return;
    const id = citationAnchorTarget(anchor.getAttribute('href'));
    if (!id) return;

    // Ours: never let the browser navigate, even if the entry has scrolled out
    // of the DOM (a closed factor tab) and we end up doing nothing.
    event.preventDefault();
    const target = this.doc.getElementById(id);
    if (!target) return;

    const win = this.doc.defaultView;
    const smooth = !win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });

    // Accessibility: the reader's keyboard position follows the jump. The
    // entry is a plain <li>, so it needs tabindex="-1" to accept focus, and
    // preventScroll stops the focus call from making its own instant jump that
    // would cancel the smooth scroll above.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });

    // Address bar only — replaceState leaves history.length untouched, so the
    // back button behaves exactly as it did before citations existed.
    if (win?.history?.replaceState) {
      const { pathname, search } = win.location;
      win.history.replaceState(win.history.state, '', `${pathname}${search}#${id}`);
    }

    this.flash(target);
  }

  ngOnDestroy(): void {
    this.clearFlash();
  }

  /** Brief highlight on the entry that was jumped to. `:target` cannot do this
   *  job — replaceState does not re-evaluate it — so the class is driven here.
   *  Outside the zone: a timer that only toggles a class must not schedule a
   *  change-detection pass. */
  private flash(target: HTMLElement): void {
    this.clearFlash();
    this.zone.runOutsideAngular(() => {
      // Restart the animation when the same entry is clicked twice.
      target.classList.remove(FLASH_CLASS);
      void target.offsetWidth;
      target.classList.add(FLASH_CLASS);
      this.flashed = target;
      this.flashTimer = setTimeout(() => this.clearFlash(), FLASH_MS);
    });
  }

  private clearFlash(): void {
    if (this.flashTimer !== null) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    this.flashed?.classList.remove(FLASH_CLASS);
    this.flashed = null;
  }
}
