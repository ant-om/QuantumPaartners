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

/**
 * Replace every `[XXX-n]` tag with its superscript marker.
 *
 * MUST run on text that is already HTML-escaped and BEFORE the markdown
 * parser — same contract as MarkdownService's gap chips. That ordering is
 * what makes the emitted HTML the only live HTML in the output: at this point
 * no attributes exist yet, so a tag can never land inside one.
 *
 * Resolved   → `<sup class="qp-cite"><a href="#qp-ref-N">[N]</a></sup>`
 * Unresolved → `<sup class="qp-cite qp-cite-unresolved" title="unverified
 *               source">[?]</sup>` — muted, never a link, claim text intact.
 */
export function annotateCitations(text: string, index: CitationIndex | null | undefined): string {
  if (!text) return text;
  const idx = index ?? EMPTY_CITATION_INDEX;
  const byNumber = new Map<number, CitationEntry>(idx.entries.map(e => [e.n, e]));

  return text.replace(citationTagRe(), (_whole: string, prefix: string, suffix: string) => {
    const tag = `${prefix}-${suffix}`;
    const n = idx.numbers[tag.toUpperCase()];
    const entry = n === undefined ? undefined : byNumber.get(n);
    if (!entry) {
      return `<sup class="qp-cite qp-cite-unresolved" title="unverified source"` +
        ` data-tag="${escapeAttr(tag)}">[?]</sup>`;
    }
    return `<sup class="qp-cite"><a href="#${CITATION_ANCHOR_PREFIX}${entry.n}"` +
      ` class="qp-cite-link" title="${escapeAttr(markerTitle(entry))}"` +
      ` data-tag="${escapeAttr(tag)}">[${entry.n}]</a></sup>`;
  });
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
