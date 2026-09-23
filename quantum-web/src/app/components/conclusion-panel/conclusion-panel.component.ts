import { Component, Input, OnChanges } from '@angular/core';
import { SectionBlock, Sentiment } from '../../services/supabase.service';
import { CitationIndex, EMPTY_CITATION_INDEX } from '../../services/citations';
import { FactorDef } from '../../models/factors';
import { ConclusionRow, chainRefLabel, conclusionRows, scoreStance } from '../../models/conclusion';

/** A module's committee conclusion as one panel: title, sentiment chip, then
 *  one stance-first row per category. The stock overview renders it inside
 *  its factor tabs; the factor sub-page renders it on its own. One component,
 *  so the two pages show identical text and identical visuals by construction.
 *
 *  certainty: 'hover'  — certainty meter + explanation in a popover on the pill (overview)
 *             'inline' — always visible under the pill (sub-page, where there is room)
 *  chainLink: 'route'  — "Sources → Chain N" navigates to the factor page anchor
 *             'anchor' — opens the matching chain accordion on the same page */
@Component({
  selector: 'app-conclusion-panel',
  standalone: false,
  templateUrl: './conclusion-panel.component.html',
  styleUrl: './conclusion-panel.component.css',
})
export class ConclusionPanelComponent implements OnChanges {
  @Input({ required: true }) blocks: SectionBlock[] | null = null;
  @Input({ required: true }) factor!: FactorDef;
  @Input({ required: true }) ticker = '';
  @Input() citations: CitationIndex = EMPTY_CITATION_INDEX;
  @Input() sentiment: Sentiment | undefined;
  /** Title links to the factor sub-page (overview) or is plain text (sub-page itself). */
  @Input() titleLink = true;
  /** Rendered under a tab strip: square top corners, no top rule. */
  @Input() tabbed = false;
  @Input() certainty: 'hover' | 'inline' = 'hover';
  @Input() chainLink: 'route' | 'anchor' = 'route';
  /** When set, each category row gets id = prefix + 1-based index, so a
   *  contents rail can anchor to it (factor page). */
  @Input() rowIdPrefix: string | null = null;

  rows: ConclusionRow[] = [];
  readonly stance = scoreStance;

  ngOnChanges(): void {
    this.rows = conclusionRows(this.blocks);
  }

  refLabel(r: number): string {
    return chainRefLabel(this.factor, r);
  }

  /** Same-page jump: open the chain's accordion, then scroll to it. Browser only. */
  jump(r: number, ev: Event): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(`chain-${r}`);
    if (!el) return; // let the href fall through to the fragment
    ev.preventDefault();
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
