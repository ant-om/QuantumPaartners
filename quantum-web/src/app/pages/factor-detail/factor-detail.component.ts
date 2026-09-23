import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { skip } from 'rxjs/operators';
import { SupabaseService, Stock, StockAnalysis, SectionBlock, FactorChain } from '../../services/supabase.service';
import { SeoService } from '../../services/seo.service';
import { CitationEntry, CitationIndex, CitationRefMap, EMPTY_CITATION_INDEX, buildCitationIndex, citedEntries } from '../../services/citations';
import { CHAIN_TOPICS, FactorDef, FactorDisplay, factorBySlug, factorDisplay, prevNextFactor } from '../../models/factors';
import { ConclusionRow, conclusionRows } from '../../models/conclusion';

/** One refined chain as the "How the analyst got there" accordion shows it. */
export interface ChainItem {
  n: number;
  /** Zero-padded label ("01") — the chains are a real sequence. */
  num: string;
  /** Anchor id; the conclusion's "Sources → Chain N" links target it. */
  id: string;
  /** Registry topic, or "Chain N" when the registry doesn't fit this run's chain count. */
  topic: string;
  /** Bracketed provenance header the run wrote, shown as a secondary line when present. */
  provenance: string | null;
  text: string;
  chars: number;
  /** Distinct [XXX-nn] source tags in the chain. */
  sources: number;
  /** First real paragraph, clipped — what the closed accordion shows. */
  teaser: string;
  /** Accordion state. Chains open by default; the reader may close them. */
  open: boolean;
  /** The stored text starts mid-document (a list item, a table row) or is a
   *  fraction of its siblings with no headings — the run emitted a fragment. */
  partial: boolean;
}

/** /stock/:ticker/:factor — the module's committee conclusion (the SAME panel
 *  the stock overview renders in its factor tab) followed by the refined
 *  round-4 chains behind it, one accordion per chain. */
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
  chainItems: ChainItem[] = [];
  chainLoading = true;
  /** Conclusion rows for the contents rail (same parser as the panel). */
  tocRows: ConclusionRow[] = [];
  /** Contents-rail entry nearest the top of the viewport. Browser only. */
  activeId: string | null = null;
  prev: FactorDef | null = null;
  next: FactorDef | null = null;
  loading = true;
  notFound = false;

  /** Inline-citation numbering for this page. Built from the conclusion rows
   *  first, then rebuilt once the lazily-fetched chains land. The conclusion
   *  text is the PREFIX of the full text list, so the rebuild only ever
   *  appends — numbers already on screen keep their values. */
  citations: CitationIndex = EMPTY_CITATION_INDEX;
  /** The References list: the entries cited by prose actually rendered here.
   *  Closed accordions are still in the DOM, so every chain counts. */
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
    // and `skip(1)` drops exactly that replay — the snapshot load below covers it.
    this.route.paramMap.pipe(skip(1)).subscribe(pm => {
      void this.load(pm.get('ticker') ?? '', pm.get('factor'));
    });
    // Same-route fragment changes (a "Sources → Chain N" link on this page,
    // or the overview's link once the page is already open) open that chain.
    this.route.fragment.pipe(skip(1)).subscribe(f => this.reveal(f));
    const pm = this.route.snapshot.paramMap;
    await this.load(pm.get('ticker') ?? '', pm.get('factor')); // awaited so SSR waits for it
  }

  private async load(ticker: string, slug: string | null): Promise<void> {
    const token = ++this.loadToken;
    const superseded = () => token !== this.loadToken;
    this.loading = true;
    this.notFound = false;
    this.chain = null;
    this.chainItems = [];
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
    this.tocRows = conclusionRows(this.blocks);
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

    // Round-4 chains are fetched lazily — they are NOT part of getAnalysis
    const chain = await this.supabase.getFactorChain(this.stock.id, factor.module);
    if (superseded()) return;
    this.chain = chain;
    this.chainItems = buildChainItems(factor.module, chain);
    this.chainLoading = false;
    // Re-number now that the chains' prose is in hand. Append-only (see the
    // `citations` field note), so nothing already rendered changes number.
    this.rebuildCitations();
    this.reveal(this.route.snapshot.fragment);
    this.watchSections();
  }

  /** Every chain open, or every chain closed. */
  get allOpen(): boolean {
    return this.chainItems.length > 0 && this.chainItems.every(c => c.open);
  }

  toggleAll(): void {
    const open = !this.allOpen;
    for (const c of this.chainItems) c.open = open;
  }

  onToggle(c: ChainItem, ev: Event): void {
    c.open = (ev.target as HTMLDetailsElement).open;
  }

  /** Contents-rail click: scroll to the section (opening a chain if needed)
   *  without a full router navigation. Browser only; SSR keeps the href. */
  jumpTo(id: string, ev: Event): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(id);
    if (!el) return;
    ev.preventDefault();
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      const item = this.chainItems.find(c => c.id === id);
      if (item) item.open = true;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
  }

  private sectionObserver: IntersectionObserver | null = null;

  /** Highlight the contents entry for the section nearest the top. */
  private watchSections(): void {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    this.sectionObserver?.disconnect();
    setTimeout(() => {
      const ids = [
        ...this.tocRows.map((_, i) => `concl-${i + 1}`),
        ...this.chainItems.map(c => c.id),
      ];
      const els = ids.map(id => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
      if (!els.length) return;
      const visible = new Map<string, number>();
      this.sectionObserver = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        if (!visible.size) return;
        this.activeId = [...visible.entries()].sort((a, b) => a[1] - b[1])[0][0];
      }, { rootMargin: '-96px 0px -60% 0px', threshold: 0 });
      for (const el of els) this.sectionObserver.observe(el);
    });
  }

  private rebuildCitations(): void {
    const texts = this.citationTexts();
    this.citations = buildCitationIndex(texts, this.citationRefs);
    this.visibleReferences = citedEntries(this.citations, texts);
  }

  /** This page's model prose in DOM order: the conclusion rows (certainty
   *  rail, then takeaway, then insight — the panel's own order), then the
   *  chains. The conclusion chain itself is not rendered separately (it IS the
   *  panel), so it is not listed. Feeds the citation numbering. */
  private citationTexts(): (string | null | undefined)[] {
    const texts: (string | null | undefined)[] = [];
    for (const r of conclusionRows(this.blocks)) texts.push(r.certaintyText, r.takeaway, r.insight);
    texts.push(this.chain?.raw);
    for (const c of this.chainItems) texts.push(c.text);
    return texts;
  }

  /** Open the chain accordion a #chain-N fragment names and scroll to it.
   *  The accordions render only after the lazy fetch above, so the router's
   *  own anchor scrolling fires too early to find them. Browser only. */
  private reveal(frag: string | null): void {
    if (typeof document === 'undefined' || !frag) return;
    setTimeout(() => {
      const el = document.getElementById(frag);
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  get blocks(): SectionBlock[] | null {
    return this.factor ? ((this.analysis as unknown as Record<string, SectionBlock[] | null>)?.[this.factor.key] ?? null) : null;
  }

}

/* ── Chain presentation helpers (pure; SSR-safe) ─────────────────────────── */

/** Topic labels apply only when the module's chain count matches the known
 *  registry exactly (refined chains + conclusion). Any mismatch → "Chain N",
 *  with the run's own bracket header (when present) as the secondary line. */
function buildChainItems(module: string, chain: FactorChain | null): ChainItem[] {
  if (!chain || chain.raw) return [];
  const topics = CHAIN_TOPICS[module];
  const total = chain.qa.length + (chain.conclusion ? 1 : 0);
  const named = !!topics && topics.length === total;
  const lengths = chain.qa.map(s => s.text.length);
  return chain.qa.map((step, i) => {
    const n = i + 1;
    const generic = step.label === `Question ${n}`;
    return {
      n,
      num: n < 10 ? `0${n}` : `${n}`,
      id: `chain-${n}`,
      topic: named ? topics[i] : `Chain ${n}`,
      provenance: generic ? null : step.label,
      text: step.text,
      chars: step.text.length,
      sources: countSources(step.text),
      teaser: chainTeaser(step.text),
      open: true,
      partial: looksPartial(step.text, lengths.filter((_, j) => j !== i)),
    };
  });
}

function countSources(text: string): number {
  const tags = new Set<string>();
  for (const m of text.matchAll(/\[([A-Z]{2,4}-[A-Z]?\d+)\]/g)) tags.add(m[1]);
  return tags.size;
}

/** The first paragraph that is prose (not a heading, table row, list item or
 *  rule) and long enough to say something, with markdown stripped and clipped
 *  at a sentence end near 300 chars. Source tags are kept so the cite pipe
 *  numbers them like the rest of the page. */
function chainTeaser(text: string): string {
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const prose = paras.find(p =>
    !/^(#{1,6}\s|\||[-*+]\s|\d+[.)]\s|>|-{3,}\s*$)/.test(p) &&
    !/^\*\*[^*]+\*\*\s*$/.test(p) &&
    p.replace(/\[[^\]]*\]/g, '').length >= 60,
  ) ?? paras[0] ?? '';
  let t = prose
    .replace(/^\*\*([^*]{2,48})[.:]\*\*\s*/, '')   // drop a leading run-in label ("**Event details.** ")
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > 300) {
    const cut = t.slice(0, 300);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    t = end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
  }
  return t;
}

/** A chain that opens on a list item or table row lost its head. A chain with
 *  no headings at all that is under 35% of its siblings' median length almost
 *  certainly did too (seen on TSLA 2026-08-23: political 3, sentiment 2,
 *  competition 2). Short quant chains keep their headings, so they pass. */
function looksPartial(text: string, siblings: number[]): boolean {
  if (/^\s*([-*+]\s|\|)/.test(text)) return true;
  if (/^\s*#/.test(text) || /\n\s*#{1,6}\s/.test(text)) return false;
  if (!siblings.length) return false;
  const sorted = [...siblings].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return text.length < median * 0.35;
}
