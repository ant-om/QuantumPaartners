import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { skip } from 'rxjs/operators';
import { SupabaseService, Stock, StockAnalysis, SectionBlock, FactorChain } from '../../services/supabase.service';
import { SeoService } from '../../services/seo.service';
import { CitationEntry, CitationIndex, CitationRefMap, EMPTY_CITATION_INDEX, buildCitationIndex, citedEntries } from '../../services/citations';
import { CHAIN_TOPICS, FactorDef, FactorDisplay, factorBySlug, factorDisplay, prevNextFactor } from '../../models/factors';

/** /stock/:ticker/:factor — one factor's full analysis + the round-4 Q&A
 *  reasoning chain (our differentiator: the reasoning is inspectable). */
@Component({
  selector: 'app-factor-detail',
  standalone: false,
  templateUrl: './factor-detail.component.html',
})
export class FactorDetailComponent implements OnInit {
  stock: Stock | null = null;
  analysis: StockAnalysis | null = null;
  factor: FactorDef | null = null;
  display: FactorDisplay | null = null;
  chain: FactorChain | null = null;
  /** Chain-topic headings — set ONLY when the parsed chain count matches the
   *  module's known topic list; null keeps the legacy "Question N" labels. */
  chainTopics: string[] | null = null;
  chainLoading = true;
  prev: FactorDef | null = null;
  next: FactorDef | null = null;
  loading = true;
  notFound = false;

  /** Inline-citation numbering for this page. Built from the analysis blocks
   *  first, then rebuilt once the lazily-fetched reasoning chain lands. The
   *  block text is the PREFIX of the full text list, so the rebuild only ever
   *  appends — numbers already on screen keep their values. */
  citations: CitationIndex = EMPTY_CITATION_INDEX;
  /** The References list: the entries cited by prose actually rendered here.
   *  Everything this page indexes IS on screen (blocks, then the chain once it
   *  lands), so this tracks `citations.entries` — but it is derived the same
   *  way as the stock page, so a source can never be listed without a marker. */
  visibleReferences: CitationEntry[] = [];
  private citationRefs: CitationRefMap = {};

  /** Guards interleaved loads. The router REUSES this component across
   *  /stock/:ticker/:factor navigations, so clicking prev/next twice in quick
   *  succession starts a second `load()` while the first is still awaiting its
   *  refs and chain. Without this the slower one lands last and paints the
   *  previous factor's chain — and its citation index — over the current
   *  route. Every await below is followed by a staleness check. */
  private loadToken = 0;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private supabase: SupabaseService,
    private seo: SeoService,
  ) {}

  async ngOnInit(): Promise<void> {
    // subscribe (not just snapshot): prev/next links navigate within this
    // component. paramMap replays its current value synchronously on subscribe,
    // and `skip(1)` drops exactly that replay — the snapshot load below covers
    // it. A boolean latch cleared after the await would instead swallow any
    // real param change that landed DURING the initial load.
    this.route.paramMap.pipe(skip(1)).subscribe(pm => {
      void this.load(pm.get('ticker') ?? '', pm.get('factor'));
    });
    const pm = this.route.snapshot.paramMap;
    await this.load(pm.get('ticker') ?? '', pm.get('factor')); // awaited so SSR waits for it
  }

  private async load(ticker: string, slug: string | null): Promise<void> {
    const token = ++this.loadToken;
    const superseded = () => token !== this.loadToken;
    this.loading = true;
    this.notFound = false;
    this.chain = null;
    this.chainTopics = null;
    this.chainLoading = true;
    this.citations = EMPTY_CITATION_INDEX;
    this.visibleReferences = [];

    const factor = factorBySlug(slug);
    if (!factor) {
      // invalid slug → the stock page
      void this.router.navigate(['/stock', ticker], { replaceUrl: true });
      return;
    }
    this.factor = factor;
    const pn = prevNextFactor(factor.slug);
    this.prev = pn.prev;
    this.next = pn.next;

    if (this.stock?.ticker !== ticker.toUpperCase()) {
      const stock = await this.supabase.getStockByTicker(ticker);
      if (superseded()) return;
      const analysis = stock ? await this.supabase.getAnalysis(stock.id) : null;
      if (superseded()) return;
      this.stock = stock;
      this.analysis = analysis;
    }
    if (!this.stock) {
      this.notFound = true;
      this.loading = false;
      this.seo.set({ title: 'Stock not found', noindex: true });
      return;
    }

    this.display = factorDisplay(this.blocks);
    // Citations are optional: getCitationRefs returns {} on any failure, and an
    // empty index makes every citation render path a no-op.
    const refs = await this.supabase.getCitationRefs(this.stock.ticker, this.analysis?.run_at ?? null);
    if (superseded()) return;
    this.citationRefs = refs;
    this.rebuildCitations();
    this.loading = false;

    this.seo.set({
      title: `${this.stock.ticker} ${factor.short} — AI Analysis Chain`,
      description: this.display?.takeaway
        ?? `${factor.label} analysis for ${this.stock.name} (${this.stock.ticker}), with the full AI reasoning chain.`,
      canonicalPath: `/stock/${this.stock.ticker}/${factor.slug}`,
      ogType: 'article',
      jsonLd: {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Stocks', item: 'https://stockbar.app/' },
          { '@type': 'ListItem', position: 2, name: this.stock.ticker, item: `https://stockbar.app/stock/${this.stock.ticker}` },
          { '@type': 'ListItem', position: 3, name: factor.label },
        ],
      },
    });

    // Round-4 chain is fetched lazily — it is NOT part of getAnalysis
    const chain = await this.supabase.getFactorChain(this.stock.id, factor.module);
    if (superseded()) return;
    this.chain = chain;
    this.chainTopics = this.resolveChainTopics(factor.module, this.chain);
    this.chainLoading = false;
    // Re-number now that the chain's prose is in hand. Append-only (see the
    // `citations` field note), so nothing already rendered changes number.
    this.rebuildCitations();
    this.scrollToFragment();
  }

  private rebuildCitations(): void {
    const texts = this.citationTexts();
    this.citations = buildCitationIndex(texts, this.citationRefs);
    this.visibleReferences = citedEntries(this.citations, texts);
  }

  /** This page's model prose in DOM order: the analysis blocks, then the
   *  reasoning chain. Feeds the citation numbering. */
  private citationTexts(): (string | null | undefined)[] {
    const texts: (string | null | undefined)[] = [];
    // takeaway → body → bullets is the order analysis-section renders them in,
    // and first-appearance numbering is defined by DOM order.
    for (const b of this.blocks ?? []) {
      texts.push(b.takeaway, b.body);
      for (const pt of b.bullets ?? []) texts.push(pt);
    }
    texts.push(this.chain?.raw);
    for (const step of this.chain?.qa ?? []) texts.push(step.text);
    texts.push(this.chain?.conclusion);
    return texts;
  }

  /** Chain-citation links from the stock page target #chain-N anchors, but the
   *  chain renders only after the lazy fetch above — the router's own anchor
   *  scrolling fires too early to find them. Browser only; no-op during SSR. */
  private scrollToFragment(): void {
    if (typeof document === 'undefined') return;
    const frag = this.route.snapshot.fragment;
    if (!frag) return;
    setTimeout(() => document.getElementById(frag)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  /** Topic labels apply only when the module's chain count matches the known
   *  topic list exactly (qa steps + conclusion). Any mismatch → null → the
   *  template keeps today's "Step N / Question N / provenance" rendering. */
  private resolveChainTopics(module: string, chain: FactorChain | null): string[] | null {
    if (!chain || chain.raw) return null;
    const topics = CHAIN_TOPICS[module];
    if (!topics) return null;
    const total = chain.qa.length + (chain.conclusion ? 1 : 0);
    return total === topics.length ? topics : null;
  }

  /** With topic headings active, the generic "Question N" fallback label adds
   *  nothing — only real bracket-provenance headers stay as the secondary line. */
  showProvenance(step: { label: string }, i: number): boolean {
    return !this.chainTopics || step.label !== `Question ${i + 1}`;
  }

  get blocks(): SectionBlock[] | null {
    return this.factor ? ((this.analysis as unknown as Record<string, SectionBlock[] | null>)?.[this.factor.key] ?? null) : null;
  }

  get metricsPlacement(): 'price' | 'financial' | null {
    if (!this.analysis?.metrics) return null;
    if (this.factor?.key === 'price') return 'price';
    if (this.factor?.key === 'financial') return 'financial';
    return null;
  }
}
