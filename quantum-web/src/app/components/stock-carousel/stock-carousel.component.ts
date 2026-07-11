import {
  Component,
  Input,
  OnChanges,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  SimpleChanges,
} from '@angular/core';
import { Router } from '@angular/router';
import EmblaCarousel, { EmblaCarouselType } from 'embla-carousel';
import { Stock } from '../../services/supabase.service';

const SECTOR_IMAGES: Record<string, string> = {
  'technology':              '1518770660439-4636190af475',
  'information technology':  '1518770660439-4636190af475',
  'financial services':      '1611974789855-9c2a0a7236a3',
  'finance':                 '1611974789855-9c2a0a7236a3',
  'financials':              '1611974789855-9c2a0a7236a3',
  'healthcare':              '1576091160399-112ba8d25d1d',
  'health care':             '1576091160399-112ba8d25d1d',
  'energy':                  '1466611653911-95081537e5b7',
  'consumer discretionary':  '1441986300917-64674bd600d8',
  'consumer staples':        '1542838132-92c53300491e',
  'communication services':  '1516321318423-f06f85e504b3',
  'communication':           '1516321318423-f06f85e504b3',
  'industrials':             '1504328345606-18bbc8c9d7d1',
  'real estate':             '1560518883-ce09059eeffa',
  'utilities':               '1497435334941-8c899ee9e8e9',
  'materials':               '1533090368676-1fd25485db88',
};

const DEFAULT_IMAGE_ID = '1611974789855-9c2a0a7236a3';

@Component({
  selector: 'app-stock-carousel',
  standalone: false,
  templateUrl: './stock-carousel.component.html',
  styleUrl: './stock-carousel.component.css',
})
export class StockCarouselComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() stocks: Stock[] = [];
  @Input() title = 'All Stocks';

  @ViewChild('emblaRef') emblaRef!: ElementRef<HTMLElement>;

  private embla: EmblaCarouselType | null = null;

  canScrollPrev = false;
  canScrollNext = false;
  currentSlide = 0;

  constructor(public router: Router) {}

  ngAfterViewInit() {
    this.initEmbla();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['stocks'] && this.embla) {
      setTimeout(() => this.embla?.reInit(), 0);
    }
  }

  ngOnDestroy() {
    this.embla?.destroy();
  }

  scrollPrev() {
    this.embla?.scrollPrev();
  }

  scrollNext() {
    this.embla?.scrollNext();
  }

  scrollTo(index: number) {
    this.embla?.scrollTo(index);
  }

  sectorImage(sector: string | undefined): string {
    const key = (sector ?? '').toLowerCase().trim();
    const id = SECTOR_IMAGES[key] ?? DEFAULT_IMAGE_ID;
    return `https://images.unsplash.com/photo-${id}?w=800&q=80`;
  }

  private initEmbla() {
    if (!this.emblaRef) return;
    this.embla = EmblaCarousel(this.emblaRef.nativeElement, {
      align: 'start',
      dragFree: false,
      containScroll: 'trimSnaps',
    });
    this.embla.on('select', () => this.updateState());
    this.embla.on('reInit', () => this.updateState());
    this.updateState();
  }

  private updateState() {
    if (!this.embla) return;
    this.canScrollPrev = this.embla.canScrollPrev();
    this.canScrollNext = this.embla.canScrollNext();
    this.currentSlide = this.embla.selectedScrollSnap();
  }
}
