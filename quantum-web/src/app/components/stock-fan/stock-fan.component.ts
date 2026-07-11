import {
  Component,
  Input,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { Router } from '@angular/router';
import { gsap } from 'gsap';
import { Stock } from '../../services/supabase.service';

const MAX_VISIBLE = 7;
const HALF = 3;

const FAN_POSITIONS = [
  { rot: -21, scale: 0.7756, x: -30, y: 7.3, zIndex: 1 },
  { rot: -14, scale: 0.8498, x: -22, y: 4.0, zIndex: 2 },
  { rot: -7, scale: 0.9346, x: -11, y: 1.3, zIndex: 3 },
  { rot: 0, scale: 1.0, x: 0, y: 0.0, zIndex: 10 },
  { rot: 7, scale: 0.9346, x: 11, y: 1.3, zIndex: 3 },
  { rot: 14, scale: 0.8498, x: 22, y: 4.0, zIndex: 2 },
  { rot: 21, scale: 0.7756, x: 30, y: 7.3, zIndex: 1 },
];

interface SlotConfig {
  rot: number;
  scale: number;
  x: number;
  y: number;
  zIndex: number;
}

function getResponsiveMultiplier(width: number): number {
  if (width < 480) return 0.28;
  if (width < 640) return 0.38;
  if (width < 768) return 0.5;
  if (width < 1024) return 0.75;
  return 1.0;
}

/**
 * Returns a multiplier (0..1] that scales y-offsets and entry animation
 * distances when the viewport is too short for the ideal layout height.
 */
function getHeightMultiplier(width: number): number {
  let idealPx: number;
  if (width < 480) idealPx = 22 * 16;
  else if (width < 640) idealPx = 26 * 16;
  else if (width < 768) idealPx = 28 * 16;
  else if (width < 1024) idealPx = 34 * 16;
  else idealPx = 38 * 16;

  const available = window.innerHeight * 0.7;
  if (available >= idealPx) return 1;
  return available / idealPx;
}

function getSlotConfig(totalCards: number, slot: number): SlotConfig {
  if (totalCards >= MAX_VISIBLE) return FAN_POSITIONS[slot];
  const center = totalCards >> 1;
  const distance = totalCards > 1 ? (slot - center) / center : 0;
  const absDistance = Math.abs(distance);
  return {
    rot: distance * 21,
    scale: 1.0 - 0.2244 * absDistance * absDistance,
    x: distance * 30,
    y: absDistance * absDistance * 7.3,
    zIndex: 10 - Math.abs(slot - center),
  };
}

@Component({
  selector: 'app-stock-fan',
  standalone: false,
  templateUrl: './stock-fan.component.html',
  styleUrl: './stock-fan.component.css',
})
export class StockFanComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() stocks: Stock[] = [];

  @ViewChild('container') containerRef!: ElementRef<HTMLDivElement>;

  /** indices whose logo image failed to load → show monogram fallback */
  failed = new Set<number>();
  centerIndex = 0;

  private isAnimating = false;
  private hasEntered = false;
  private direction: 'left' | 'right' | null = null;
  private prevVisible = new Set<number>();
  private teardown: (() => void) | null = null;
  private viewReady = false;

  constructor(public router: Router) {}

  get totalCards(): number {
    return this.stocks.length;
  }

  get needsPagination(): boolean {
    return this.totalCards > MAX_VISIBLE;
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.centerIndex = this.needsPagination ? HALF : this.totalCards >> 1;
    this.runLayout();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['stocks'] && this.viewReady) {
      // fresh dataset → replay the entry animation
      this.hasEntered = false;
      this.prevVisible = new Set();
      this.direction = null;
      this.failed = new Set();
      this.centerIndex = this.needsPagination ? HALF : this.totalCards >> 1;
      // wait for *ngFor to render the new .fan-card nodes
      setTimeout(() => this.runLayout(), 0);
    }
  }

  ngOnDestroy(): void {
    this.teardown?.();
    const c = this.containerRef?.nativeElement;
    if (c) gsap.killTweensOf(c.querySelectorAll('.fan-card'));
  }

  onLogoError(i: number): void {
    this.failed.add(i);
  }

  monogram(s: Stock): string {
    return (s.ticker || '?').slice(0, 2).toUpperCase();
  }

  cycle(direction: 'left' | 'right'): void {
    if (this.isAnimating || !this.needsPagination) return;
    this.direction = direction;
    this.centerIndex =
      direction === 'right'
        ? (this.centerIndex + 1) % this.totalCards
        : (this.centerIndex - 1 + this.totalCards) % this.totalCards;
    this.runLayout();
  }

  private getVisibleMap(center: number): Map<number, number> {
    const map = new Map<number, number>();
    if (!this.needsPagination) {
      this.stocks.forEach((_, i) => map.set(i, i));
      return map;
    }
    for (let slot = 0; slot < MAX_VISIBLE; slot++) {
      map.set(
        ((center + slot - HALF) % this.totalCards + this.totalCards) % this.totalCards,
        slot,
      );
    }
    return map;
  }

  private runLayout(): void {
    // tear down listeners from a previous layout pass
    this.teardown?.();
    this.teardown = null;

    const container = this.containerRef?.nativeElement;
    if (!container || !this.totalCards || typeof window === 'undefined') return;

    const cardElements = Array.from(
      container.querySelectorAll<HTMLElement>('.fan-card'),
    );
    if (!cardElements.length) return;

    const visibleMap = this.getVisibleMap(this.centerIndex);
    const previouslyVisible = this.prevVisible;
    const direction = this.direction;
    const isFirstMount = !this.hasEntered;
    const multiplier = getResponsiveMultiplier(window.innerWidth);
    const hMult = getHeightMultiplier(window.innerWidth);
    const slotCount = this.needsPagination ? MAX_VISIBLE : this.totalCards;
    const config = (slot: number) => getSlotConfig(slotCount, slot);

    if (isFirstMount) this.isAnimating = true;

    let completedCount = 0;
    const visibleCount = visibleMap.size;
    const onCardDone = () => {
      if (++completedCount >= visibleCount) {
        this.isAnimating = false;
        if (isFirstMount) this.hasEntered = true;
      }
    };

    cardElements.forEach((card, cardIndex) => {
      const slot = visibleMap.get(cardIndex);
      const wasVisible = previouslyVisible.has(cardIndex);

      if (slot !== undefined) {
        const { x, y, rot, scale, zIndex } = config(slot);
        const target = {
          x: `${x * multiplier}rem`,
          y: `${y * hMult}rem`,
          rotation: rot,
          scale,
          opacity: 1,
          zIndex,
        };

        if (isFirstMount) {
          gsap.set(card, { x: 0, y: `${12 * hMult}rem`, rotation: 0, scale: 0.5, opacity: 0 });
          gsap.to(card, {
            ...target,
            duration: 1.2,
            ease: 'elastic.out(1.05,.78)',
            delay: 0.2 + slot * 0.06,
            onComplete: onCardDone,
          });
        } else if (!wasVisible) {
          const enterX = direction === 'right' ? 40 : -40;
          gsap.set(card, {
            x: `${enterX}rem`,
            y: `${y * hMult}rem`,
            rotation: direction === 'right' ? 30 : -30,
            scale: 0.5,
            opacity: 0,
          });
          gsap.to(card, { ...target, duration: 0.6, ease: 'power2.out', onComplete: onCardDone });
        } else {
          gsap.to(card, { ...target, duration: 0.5, ease: 'power2.out', onComplete: onCardDone });
        }
      } else if (wasVisible) {
        const exitX = direction === 'right' ? -40 : 40;
        gsap.to(card, {
          x: `${exitX}rem`,
          opacity: 0,
          scale: 0.5,
          rotation: direction === 'right' ? -30 : 30,
          duration: 0.4,
          ease: 'power2.in',
          zIndex: 0,
        });
      } else if (isFirstMount) {
        gsap.set(card, { opacity: 0, scale: 0.3, x: 0, y: 0, zIndex: 0 });
      }
    });

    this.prevVisible = new Set(visibleMap.keys());

    // ---- Hover interactions ----
    const visibleEntries: { el: HTMLElement; slot: number }[] = [];
    cardElements.forEach((el, i) => {
      const slot = visibleMap.get(i);
      if (slot !== undefined) visibleEntries.push({ el, slot });
    });
    visibleEntries.sort((a, b) => a.slot - b.slot);

    let activeSlot: number | null = null;
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;
    const centerSlot = visibleEntries.length >> 1;

    const updateHoverLayout = (hoveredSlot: number | null) => {
      const mult = getResponsiveMultiplier(window.innerWidth);
      const hM = getHeightMultiplier(window.innerWidth);

      visibleEntries.forEach(({ el, slot }) => {
        const base = config(slot);
        let targetX = base.x * mult;
        let targetY = base.y * hM;
        let targetRot = base.rot;
        let targetScale = base.scale;
        let delay = 0;

        if (hoveredSlot !== null) {
          const distance = Math.abs(slot - hoveredSlot);
          delay = distance * 0.02;

          if (slot === hoveredSlot) {
            targetY -= 2.5 * hM;
            targetScale *= 1.08;
          } else {
            const normalized = centerSlot > 0 ? (slot - centerSlot) / centerSlot : 0;
            const pushStrength =
              8 * (1 - Math.abs(normalized)) * (1 + 0.2 * Math.max(0, 3 - distance));

            if (slot < hoveredSlot) {
              targetX -= pushStrength * mult;
              targetRot -= 3 / (distance + 1);
            } else {
              targetX += pushStrength * mult;
              targetRot += 3 / (distance + 1);
            }

            if (slot === visibleEntries.length - 1 && hoveredSlot < centerSlot) targetY -= 1 * hM;
            if (slot === 0 && hoveredSlot > centerSlot) targetY -= 1 * hM;
          }
        } else {
          delay = Math.abs(slot - centerSlot) * 0.02;
        }

        gsap.to(el, {
          x: `${targetX}rem`,
          y: `${targetY}rem`,
          rotation: targetRot,
          scale: targetScale,
          duration: 0.5,
          delay,
          ease: 'elastic.out(1,.75)',
          overwrite: 'auto',
        });
        gsap.set(el, { zIndex: base.zIndex });
      });
    };

    const enterHandlers = visibleEntries.map(({ el, slot }) => {
      const handler = () => {
        if (this.isAnimating) return;
        if (leaveTimer) {
          clearTimeout(leaveTimer);
          leaveTimer = null;
        }
        if (activeSlot !== slot) {
          activeSlot = slot;
          updateHoverLayout(slot);
        }
      };
      el.addEventListener('mouseenter', handler);
      return { el, handler };
    });

    const onMouseLeave = () => {
      if (this.isAnimating) return;
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        activeSlot = null;
        updateHoverLayout(null);
      }, 50);
    };
    container.addEventListener('mouseleave', onMouseLeave);

    const onResize = () => {
      if (!this.isAnimating) updateHoverLayout(activeSlot);
    };
    window.addEventListener('resize', onResize);

    this.teardown = () => {
      enterHandlers.forEach(({ el, handler }) => el.removeEventListener('mouseenter', handler));
      container.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('resize', onResize);
      if (leaveTimer) clearTimeout(leaveTimer);
    };
  }
}
