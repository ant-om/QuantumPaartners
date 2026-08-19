import { Component, Input } from '@angular/core';
import { CITATION_ANCHOR_PREFIX, CitationEntry } from '../../services/citations';

/** The page's References list — the landing target for every inline `[n]`
 *  marker. One entry per SOURCE (a url cited by several tags appears once).
 *
 *  `entries` is the page's VISIBLE citations (see citedEntries): numbers stay
 *  page-wide so they never reshuffle when a tab opens, but a source cited only
 *  by prose behind a closed tab is not listed — no orphan bibliography.
 *  Renders nothing when there are none, so pages without citations look
 *  exactly as before. */
@Component({
  selector: 'app-references',
  standalone: false,
  template: `
    <div *ngIf="entries && entries.length" id="section-references" class="qp-references">
      <h2 class="qp-section-heading">References</h2>
      <p class="qp-references-note">
        Sources cited inline above, numbered by first appearance. Links open the
        original document.
      </p>
      <ol class="qp-ref-list">
        <li *ngFor="let e of entries" class="qp-ref-item" [id]="anchor(e.n)">
          <span class="qp-ref-n qp-mono">{{ e.n }}.</span><!--
       --><span class="qp-ref-text"><span class="qp-ref-source">{{ e.source }}</span><ng-container
              *ngIf="e.url"> — <a class="qp-ref-url" [href]="e.url" target="_blank"
              rel="noopener nofollow">{{ e.urlLabel }}</a></ng-container><ng-container
              *ngIf="e.asOf">, as of <span class="qp-ref-asof qp-mono"
              [attr.title]="e.asOfKind ? 'date kind: ' + e.asOfKind : null">{{ e.asOf }}</span></ng-container><ng-container
              *ngIf="e.type"> ({{ e.type }})</ng-container></span>
        </li>
      </ol>
    </div>
  `,
  styles: [`
    .qp-references { margin-top: 52px; }
    .qp-references-note { color: var(--text-muted); font-size: 0.82rem; margin: 0 0 14px;
      max-width: 62ch; }
    .qp-ref-list { list-style: none; margin: 0; padding: 0;
      border-top: 1px solid var(--border); }
    .qp-ref-item { display: flex; gap: 10px; align-items: baseline;
      padding: 9px 2px; border-bottom: 1px solid var(--border);
      font-size: 0.84rem; line-height: 1.6; color: var(--text-2); scroll-margin-top: 90px; }
    .qp-ref-item:target { background: var(--accent-soft); }
    .qp-ref-n { color: var(--accent); font-size: 0.75rem; flex: 0 0 auto;
      min-width: 1.9em; text-align: right; }
    .qp-ref-text { min-width: 0; overflow-wrap: anywhere; }
    .qp-ref-source { color: var(--text); font-weight: 600; }
    .qp-ref-url, .qp-ref-url:visited { color: var(--oxford); text-decoration: none;
      border-bottom: 1px solid rgba(15, 84, 153, 0.35); }
    .qp-ref-url:hover { border-bottom-color: var(--oxford); }
    .qp-ref-asof { font-size: 0.78rem; color: var(--text-2); }
  `],
})
export class ReferencesComponent {
  @Input() entries: CitationEntry[] | null = null;

  anchor(n: number): string {
    return `${CITATION_ANCHOR_PREFIX}${n}`;
  }
}
