/** ─────────────────────────────────────────────────────────────────────────
 *  Inline citations (Wikipedia-style).
 *
 *  The n8n pipeline writes bare tags into its analysis prose — `[SEN-12]`,
 *  `[FS-Q10]`, `[MAC-F6]` — and stores the sources for those tags separately,
 *  one Supabase `citation_refs` row per module. The models NEVER write URLs;
 *  every href on the page comes from the refs map, which is why this file is
 *  the only place a citation link is ever built.
 *
 *  Everything here is pure (no Angular, no DOM) so it renders identically
 *  under SSR and can be exercised by a plain node test — see
 *  tools/citations.test.mjs.
 *  ───────────────────────────────────────────────────────────────────────── */

/** One source, as stored in `citation_refs.refs` under its tag key. */
export interface CitationRef {
  source?: string | null;
  url?: string | null;
  as_of?: string | null;
  as_of_kind?: string | null;
  type?: string | null;
  ref?: string | null;
}

/** tag (upper-cased, e.g. "SEN-12") → source. All modules merged into one. */
export type CitationRefMap = Record<string, CitationRef>;

/** One numbered entry in the page's References list. */
export interface CitationEntry {
  /** 1-based reference number, assigned by first appearance on the page. */
  n: number;
  /** Every tag that resolves to this source (same url = one entry). */
  tags: string[];
  source: string;
  /** http(s) only — anything else is dropped so a tag can never link out to
   *  a `javascript:` / `data:` URL the model smuggled into the refs row. */
  url: string | null;
  /** Display form of `url` (host + path, trimmed) for the References list. */
  urlLabel: string | null;
  asOf: string | null;
  asOfKind: string | null;
  type: string | null;
  ref: string | null;
}

export interface CitationIndex {
  /** upper-cased tag → reference number. Missing = unresolved tag. */
  numbers: Record<string, number>;
  /** The References list, already in citation order. */
  entries: CitationEntry[];
}

/** Stable, empty index — a shared reference so pure pipes don't re-render. */
export const EMPTY_CITATION_INDEX: CitationIndex = { numbers: {}, entries: [] };

/** Anchor id prefix for the References list items (`id="qp-ref-3"`). */
export const CITATION_ANCHOR_PREFIX = 'qp-ref-';

/**
 * How many DISTINCT references one uninterrupted run of markers may show.
 *
 * The chains habitually stack every tag that touched a claim onto its full
 * stop — the live TSLA political page carries a twelve-marker pile-up
 * (`[PQ-L31][PQ-L32][PQ-L9]…`) and the management page repeats a reference in
 * 46 of its 59 runs. Past about three the markers stop being citations and
 * become a wall the eye skips, so a run is truncated to its first few and the
 * rest stay reachable in the References list (see annotateCitations).
 */
export const CITATION_RUN_MAX = 3;

/** Fresh matcher per call — a shared /g regex carries `lastIndex` between
 *  calls and would silently skip tags. */
export function citationTagRe(): RegExp {
  return /\[([A-Z]{2,5})-([A-Za-z0-9]+)\]/g;
}

/** True when the text carries at least one citation tag. */
export function hasCitationTags(text: string | null | undefined): boolean {
  return typeof text === 'string' && citationTagRe().test(text);
}

/* ── Building the index ─────────────────────────────────────────────────── */

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * UTC date key (`YYYY-MM-DD`) used to pair an analysis with its OWN run's refs.
 *
 * Citation tags are minted per run: `[SEN-12]` on the 19th and `[SEN-12]` on
 * the 20th are DIFFERENT sources. So the refs lookup is an exact date match on
 * the analysis row's `run_at` — never "the newest refs we have". An
 * unparseable value returns null, which callers must treat as "no refs", not
 * as an invitation to guess a day.
 *
 * `stock_analyses.run_at` is a timestamptz; PostgREST renders it with an
 * explicit offset (`2026-08-19T00:00:00+00:00`) and `citation_refs.run_date`
 * is the plain date written for that same run, so the comparison is date-only
 * in UTC. A bare or UTC-stamped date is taken literally (no timezone maths
 * that could shift the day); only a non-UTC offset is converted.
 */
export function citationRunDateKey(value: unknown): string | null {
  const t = str(value);
  if (!t) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(t);
  if (!m) return null;
  if (!m[2] || !m[3] || /^(Z|\+00:?00)$/i.test(m[3])) return m[1];
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

/** Only absolute http(s) URLs are ever usable as an href. */
export function safeUrl(v: unknown): string | null {
  const t = str(v);
  if (!t) return null;
  return /^https?:\/\/[^\s<>"'`]+$/i.test(t) ? t : null;
}

/** Dedupe key: lowercase scheme+host, drop the fragment and trailing slashes.
 *  Path case is preserved — some CMSes serve case-sensitive slugs. */
function normalizeUrl(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/i.exec(url);
  const base = m ? m[1].toLowerCase() + m[2].toLowerCase() + m[3] : url;
  return base.replace(/#.*$/, '').replace(/\/+$/, '');
}

function shortenUrl(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/i.exec(url);
  if (!m) return url;
  const label = m[1].replace(/^www\./i, '') + (m[2] || '').replace(/\/+$/, '');
  return label.length > 68 ? label.slice(0, 67) + '…' : label;
}

function coerceRef(raw: Record<string, unknown>): CitationRef {
  return {
    source: str(raw['source']),
    url: str(raw['url']),
    as_of: str(raw['as_of']),
    as_of_kind: str(raw['as_of_kind']),
    type: str(raw['type']),
    ref: str(raw['ref']),
  };
}

/** Merge every `citation_refs` row (one per module) into a single tag map.
 *  Tag keys are upper-cased; a later row only wins a collision when it brings
 *  a url the earlier one lacked. Anything malformed is skipped, never thrown. */
export function mergeCitationRows(rows: unknown): CitationRefMap {
  const out: CitationRefMap = {};
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const refs = (row as { refs?: unknown } | null | undefined)?.refs;
    if (!refs || typeof refs !== 'object' || Array.isArray(refs)) continue;
    for (const [rawKey, rawVal] of Object.entries(refs as Record<string, unknown>)) {
      const key = String(rawKey).trim().toUpperCase();
      if (!key || !rawVal || typeof rawVal !== 'object' || Array.isArray(rawVal)) continue;
      const ref = coerceRef(rawVal as Record<string, unknown>);
      const existing = out[key];
      if (!existing || (!safeUrl(existing.url) && safeUrl(ref.url))) out[key] = ref;
    }
  }
  return out;
}

/**
 * Number every citation tag found in `texts`, in order.
 *
 * Rules (approved design):
 *  - numbering is by FIRST APPEARANCE — pass `texts` in document order;
 *  - the same SOURCE (same url) cited by different tags or different sections
 *    is ONE reference entry, and every one of those tags reuses its number;
 *  - a tag with no entry in `refs` gets NO number — it renders as a muted,
 *    unlinked marker (see annotateCitations) so the claim text survives but
 *    the reader is never handed a dead link.
 */
export function buildCitationIndex(
  texts: readonly (string | null | undefined)[],
  refs: CitationRefMap | null | undefined,
): CitationIndex {
  const map = refs ?? {};
  const numbers: Record<string, number> = {};
  const entries: CitationEntry[] = [];
  const byDedupeKey = new Map<string, CitationEntry>();

  for (const text of texts) {
    if (typeof text !== 'string' || !text) continue;
    const re = citationTagRe();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const tag = `${m[1]}-${m[2]}`;
      const key = tag.toUpperCase();
      if (numbers[key] !== undefined) continue; // already numbered
      const ref = map[key];
      if (!ref) continue; // unresolved — deliberately left un-numbered

      const url = safeUrl(ref.url);
      const source = str(ref.source) ?? str(ref.ref) ?? tag;
      const dedupeKey = url
        ? `u:${normalizeUrl(url)}`
        : `s:${source.toLowerCase()}|${str(ref.as_of) ?? ''}`;

      let entry = byDedupeKey.get(dedupeKey);
      if (!entry) {
        entry = {
          n: entries.length + 1,
          tags: [],
          source,
          url,
          urlLabel: url ? shortenUrl(url) : null,
          asOf: str(ref.as_of),
          asOfKind: str(ref.as_of_kind),
          type: str(ref.type),
          ref: str(ref.ref),
        };
        entries.push(entry);
        byDedupeKey.set(dedupeKey, entry);
      }
      entry.tags.push(tag);
      numbers[key] = entry.n;
    }
  }

  return entries.length ? { numbers, entries } : EMPTY_CITATION_INDEX;
}

/**
 * The entries actually cited by `texts`, in reference order, each keeping its
 * page-wide number.
 *
 * Numbering is global on purpose — it is built from ALL of a page's prose so a
 * number never reshuffles when the reader opens a factor tab. The References
 * LIST, though, must show only what the reader can see: a page whose tagged
 * prose is still behind a closed tab would otherwise print an orphan
 * bibliography of sources cited nowhere on screen. Feed this the texts that
 * are currently in the DOM; feed `annotateCitations` the full index.
 */
export function citedEntries(
  index: CitationIndex | null | undefined,
  texts: readonly (string | null | undefined)[],
): CitationEntry[] {
  const idx = index ?? EMPTY_CITATION_INDEX;
  if (!idx.entries.length) return [];
  const shown = new Set<number>();
  for (const text of texts) {
    if (typeof text !== 'string' || !text) continue;
    const re = citationTagRe();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = idx.numbers[`${m[1]}-${m[2]}`.toUpperCase()];
      if (n !== undefined) shown.add(n);
    }
  }
  return idx.entries.filter(e => shown.has(e.n));
}

/* ── Rendering ──────────────────────────────────────────────────────────── */

/** Attribute-safe escape (quotes included — escapeHtml in MarkdownService
 *  deliberately leaves quotes alone because its output is never an attribute;
 *  ours is). */
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Hover text for a numbered marker: "Reuters — as of 2026-08-14 (news)". */
function markerTitle(entry: CitationEntry): string {
  let title = entry.source;
  if (entry.asOf) title += ` — as of ${entry.asOf}`;
  if (entry.type) title += ` (${entry.type})`;
  return title;
}

/** True when everything between two tags is marker glue: spaces, tabs, at most
 *  one line break, and the stray comma some chains write between tags.
 *
 *  Anything else — a word, a markdown table's `|`, a blank line — means the two
 *  markers are not visually adjacent to the reader, so they are NOT one run and
 *  neither is collapsed against the other. That is what keeps a table column of
 *  `[MAC-R1]` cells, or two consecutive list items, intact. */
function isMarkerGap(gap: string): boolean {
  return /^[ \t\u00a0,;]*(?:\r?\n)?[ \t\u00a0,;]*$/.test(gap);
}

/** One `[XXX-n]` occurrence found in the source text. `entry` is undefined for
 *  an unresolved tag — those are never grouped and never dropped. */
interface TagHit {
  start: number;
  end: number;
  tag: string;
  entry: CitationEntry | undefined;
}

function unresolvedMarker(tag: string): string {
  return `<span class="qp-cite-unresolved" title="unverified source"` +
    ` data-tag="${escapeAttr(tag)}">[${escapeAttr(tag)}]</span>`;
}

/** `more` = reference numbers the cap removed from this run; they are recorded
 *  on the last surviving marker so a truncated run stays auditable in the DOM
 *  (and greppable in a rendered page) without printing anything extra. */
function resolvedMarker(hit: TagHit, more: readonly number[]): string {
  const entry = hit.entry as CitationEntry;
  return `<sup class="qp-cite"><a href="#${CITATION_ANCHOR_PREFIX}${entry.n}"` +
    ` class="qp-cite-link" title="${escapeAttr(markerTitle(entry))}"` +
    ` data-tag="${escapeAttr(hit.tag)}"` +
    (more.length ? ` data-more="${more.join(',')}"` : '') +
    `>[${entry.n}]</a></sup>`;
}

/**
 * Render ONE run of adjacent resolved markers, de-duplicated and capped.
 *
 *  - a number already shown in this run is dropped — this is the whole fix:
 *    `[MGT-4][MGT-45]` (two tags, one DEF 14A) and `[POL-31][POL-31]` (one tag
 *    written twice) both stop rendering as `[4][4]`;
 *  - past CITATION_RUN_MAX distinct numbers the rest are dropped too, keeping
 *    the FIRST ones in the order the writer put them;
 *  - a dropped marker takes its own preceding separator with it, so collapsing
 *    `[1], [1]` leaves `[1]` and not a stranded comma.
 *
 * Nothing is dropped from the numbering or the References list: those are
 * derived from the raw prose (buildCitationIndex / citedEntries), which still
 * contains every tag, so a truncated run still lists all of its sources.
 */
function renderMarkerRun(run: readonly TagHit[], text: string): string {
  if (!run[0].entry) return unresolvedMarker(run[0].tag);

  const kept: { hit: TagHit; gap: string }[] = [];
  const shown = new Set<number>();
  const more: number[] = [];
  for (let i = 0; i < run.length; i++) {
    const n = (run[i].entry as CitationEntry).n;
    if (shown.has(n)) continue;                    // same reference twice in a row
    if (shown.size >= CITATION_RUN_MAX) {          // run is already long enough
      if (!more.includes(n)) more.push(n);
      continue;
    }
    shown.add(n);
    kept.push({ hit: run[i], gap: i === 0 ? '' : text.slice(run[i - 1].end, run[i].start) });
  }
  return kept
    .map((k, i) => k.gap + resolvedMarker(k.hit, i === kept.length - 1 ? more : []))
    .join('');
}

/**
 * Replace every `[XXX-n]` tag with its superscript marker.
 *
 * MUST run on text that is already HTML-escaped and BEFORE the markdown
 * parser — same contract as MarkdownService's gap chips. That ordering is
 * what makes the emitted HTML the only live HTML in the output: at this point
 * no attributes exist yet, so a tag can never land inside one.
 *
 * Resolved   → `<sup class="qp-cite"><a href="#qp-ref-N">[N]</a></sup>`
 * Unresolved → `<span class="qp-cite-unresolved" title="unverified source">
 *               [US-EU]</span>` — the writer's OWN bracket text, muted, never
 *               a link.
 *
 * The unresolved branch must never replace what was written. This grammar also
 * matches ordinary prose — `[US-EU]`, `[FY-2025]`, `[Q3-2026]` — and a bare
 * `[?]` would silently destroy it. Keeping the literal is better in both
 * directions: real prose survives intact, and a model-minted pseudo-tag
 * (`[RB-Apr]`, `[LRN-CA]`) stays legible and diagnosable instead of collapsing
 * into an anonymous question mark. It is deliberately NOT superscripted
 * either: a raised `[FY-2025]` would misrepresent prose as a reference marker.
 *
 * Adjacent resolved markers are gathered into a RUN and thinned by
 * renderMarkerRun — repeats collapse, long pile-ups are capped. An unresolved
 * tag prints its own text, so it can never be part of a run and is never
 * touched by that logic.
 */
export function annotateCitations(text: string, index: CitationIndex | null | undefined): string {
  if (!text) return text;
  const idx = index ?? EMPTY_CITATION_INDEX;
  const byNumber = new Map<number, CitationEntry>(idx.entries.map(e => [e.n, e]));

  const hits: TagHit[] = [];
  const re = citationTagRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = `${m[1]}-${m[2]}`;
    const n = idx.numbers[tag.toUpperCase()];
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      tag,
      entry: n === undefined ? undefined : byNumber.get(n),
    });
  }
  if (!hits.length) return text;

  const out: string[] = [];
  let cursor = 0;
  for (let i = 0; i < hits.length; ) {
    let j = i + 1;
    if (hits[i].entry) {
      while (j < hits.length && hits[j].entry &&
             isMarkerGap(text.slice(hits[j - 1].end, hits[j].start))) j++;
    }
    out.push(text.slice(cursor, hits[i].start));
    out.push(renderMarkerRun(hits.slice(i, j), text));
    cursor = hits[j - 1].end;
    i = j;
  }
  out.push(text.slice(cursor));
  return out.join('');
}

/** HTML-escape + citation markers for prose rendered WITHOUT markdown
 *  (headlines, takeaways, horizon rationales). Same escape-then-annotate
 *  order as the markdown path, so the only live HTML is ours. */
export function renderCitedText(
  text: string | null | undefined,
  index: CitationIndex | null | undefined,
): string {
  if (text === null || text === undefined) return '';
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return annotateCitations(escaped, index);
}
