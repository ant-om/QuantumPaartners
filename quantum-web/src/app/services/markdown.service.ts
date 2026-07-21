import { Injectable } from '@angular/core';
import { Marked } from 'marked';
import { FACTOR_LINK_TERMS, FactorLinkTerm } from '../models/factors';

/** Options for one render() call. */
export interface MdRenderOptions {
  /** When set, factor cross-links are generated as /stock/{TICKER}/{slug}. */
  ticker?: string;
  /** Factor slug of the page being rendered — a factor never links to itself. */
  currentFactor?: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pure pipeline (no Angular, no document/window — identical under SSR).
 * Order matters:
 *   (a) HTML-escape the raw model output. Any literal HTML in the source
 *       becomes inert text; from here on, the ONLY live HTML is what WE emit
 *       (gap chips, factor links) or what marked generates from markdown.
 *       This is the invariant that makes bypassSecurityTrustHtml safe.
 *   (b) [GAP: ...] tags → inline chips (inner text already escaped by (a)).
 *   (c) marked (gfm, no breaks; v12+ adds no heading ids by default).
 *   (d) headings demoted via walkTokens: h1-h3 → h4, h4+ → h5 (page owns h1-h3).
 *   (e) tables wrapped for horizontal scroll; javascript:/data: hrefs from
 *       model-authored markdown links neutralized (defense in depth).
 *   (f) optional factor cross-linking on text nodes only.
 * ──────────────────────────────────────────────────────────────────────────── */

function escapeHtml(text: string): string {
  // & first, then angle brackets. Quotes are not escaped: source text never
  // lands in an attribute (marked escapes its own attribute output).
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** [GAP: ...] → inline chip. Runs on escaped text, so `inner` is inert. */
function markGapTags(text: string): string {
  return text.replace(
    /\[GAP:\s*([^\]\n]*?)\s*\]/gi,
    (_m, inner: string) => `<span class="qp-gap-chip">GAP: ${inner}</span>`,
  );
}

const markedInstance = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  walkTokens: token => {
    if (token.type === 'heading') {
      token.depth = token.depth <= 3 ? 4 : 5;
    }
  },
});

function postProcess(html: string): string {
  return html
    .replace(/<table>/g, '<div class="qp-table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(/(<a\s+href=")\s*(?:javascript|vbscript|data):[^"]*"/gi, '$1#"');
}

/* ── Factor cross-linking (Task 2) ──────────────────────────────────────────
 * Post-parse, text-node-safe: the HTML is split on tags and only text
 * segments are eligible, so attributes/tags can never be corrupted. Segments
 * inside links, code, headings, table headers or gap chips are skipped
 * (marked emits no <span> of its own — every span is one of our chips). */

const LINKIFY_SKIP_TAGS = new Set(['a', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th', 'span']);

function linkifyFactors(html: string, ticker: string, currentFactor?: string): string {
  const terms = FACTOR_LINK_TERMS.filter(t => t.slug !== currentFactor);
  if (!terms.length) return html;
  const base = `/stock/${encodeURIComponent(ticker.toUpperCase())}/`;
  const used = new Set<string>();
  let skipDepth = 0;
  const out: string[] = [];
  for (const part of html.split(/(<[^>]+>)/)) {
    if (!part) continue;
    if (part.charCodeAt(0) === 60 /* '<' */) {
      const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(part);
      if (tag && LINKIFY_SKIP_TAGS.has(tag[2].toLowerCase())) {
        skipDepth = tag[1] ? Math.max(0, skipDepth - 1) : skipDepth + 1;
      }
      out.push(part);
      continue;
    }
    out.push(skipDepth > 0 || used.size === terms.length ? part : linkSegment(part, terms, used, base));
  }
  return out.join('');
}

/** Links the first occurrence of each still-unused factor term in one text
 *  segment. Earliest match wins; on a tie the longer phrase wins. Scanning
 *  resumes AFTER each inserted link, so link text is never re-matched. */
function linkSegment(text: string, terms: FactorLinkTerm[], used: Set<string>, base: string): string {
  let result = '';
  let pos = 0;
  while (pos < text.length && used.size < terms.length) {
    let best: { slug: string; start: number; end: number } | null = null;
    for (const t of terms) {
      if (used.has(t.slug)) continue;
      for (const re of t.patterns) {
        const m = re.exec(text.slice(pos));
        if (!m) continue;
        const start = pos + m.index;
        const end = start + m[0].length;
        if (!best || start < best.start || (start === best.start && end > best.end)) {
          best = { slug: t.slug, start, end };
        }
      }
    }
    if (!best) break;
    result +=
      text.slice(pos, best.start) +
      `<a class="qp-inline-link" href="${base}${best.slug}">` +
      text.slice(best.start, best.end) +
      '</a>';
    used.add(best.slug);
    pos = best.end;
  }
  return result + text.slice(pos);
}

/** Exported for non-Angular sanity checks; MarkdownService delegates here. */
export function renderAnalysisMarkdown(text: string | null | undefined, options: MdRenderOptions = {}): string {
  if (text === null || text === undefined) return '';
  const raw = String(text);
  if (!raw.trim()) return '';
  const src = markGapTags(escapeHtml(raw));
  let html = markedInstance.parse(src, { async: false }) as string;
  html = postProcess(html);
  if (options.ticker) {
    html = linkifyFactors(html, options.ticker, options.currentFactor);
  }
  return html;
}

/** Renders AI-generated analysis markdown to HTML (see pipeline notes above).
 *  Pure string-in/string-out — safe under SSR (never touches the DOM). */
@Injectable({ providedIn: 'root' })
export class MarkdownService {
  render(text: string | null | undefined, options: MdRenderOptions = {}): string {
    return renderAnalysisMarkdown(text, options);
  }
}
