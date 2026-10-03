/**
 * Node-runnable test for the pure citation logic (src/app/services/citations.ts).
 *
 *   node tools/citations.test.mjs
 *
 * No karma, no browser: the module is deliberately Angular-free, so it is
 * transpiled with the esbuild already in node_modules and imported directly.
 *
 * The second half does the same to CitationScrollDirective — the click handler
 * that keeps an inline marker on the page instead of letting `<base href="/">`
 * send it to the home route. It is Angular-decorated but its handler is plain
 * code, so it is bundled against three-line @angular stubs and driven over a
 * fake DOM. Same runner, no chrome required.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'qp-cite-'));
const bundle = join(out, 'citations.mjs');
try {
  execFileSync(
    join(root, 'node_modules/.bin/esbuild'),
    [join(root, 'src/app/services/citations.ts'), '--format=esm', '--target=es2022', `--outfile=${bundle}`],
    { stdio: 'pipe' },
  );
} catch (err) {
  console.error(String(err.stderr ?? err));
  process.exit(1);
}

const {
  buildCitationIndex, annotateCitations, renderCitedText, mergeCitationRows,
  EMPTY_CITATION_INDEX, safeUrl, citationRunDateKey, citedEntries,
  CITATION_RUN_MAX, citationAnchorTarget, CITATION_ANCHOR_PREFIX,
  passageCount, marketQuestion,
} = await import(pathToFileURL(bundle).href);

/* ── the directive, bundled against @angular stubs ─────────────────────── */

const esbuild = join(root, 'node_modules/.bin/esbuild');
const stub = (name, src) => {
  const file = join(out, name);
  writeFileSync(file, src);
  return file;
};
// Only the four symbols citation-scroll.directive.ts imports. The decorators
// are no-ops: the class body — which is the thing under test — is untouched.
const coreStub = stub('ng-core.mjs', `
  export const Directive = () => (c) => c;
  export const HostListener = () => () => {};
  export const Inject = () => () => {};
  export const PLATFORM_ID = 'PLATFORM_ID';
  export class NgZone { runOutsideAngular(fn) { return fn(); } }
`);
const commonStub = stub('ng-common.mjs', `
  export const DOCUMENT = 'DOCUMENT';
  export const isPlatformBrowser = (id) => id === 'browser';
`);
const dirBundle = join(out, 'citation-scroll.mjs');
try {
  execFileSync(esbuild, [
    join(root, 'src/app/directives/citation-scroll.directive.ts'),
    '--bundle', '--format=esm', '--target=es2022',
    `--alias:@angular/core=${coreStub}`, `--alias:@angular/common=${commonStub}`,
    '--tsconfig-raw={"compilerOptions":{"experimentalDecorators":true,"useDefineForClassFields":false}}',
    `--outfile=${dirBundle}`,
  ], { stdio: 'pipe' });
} catch (err) {
  console.error(String(err.stderr ?? err));
  process.exit(1);
}
const { CitationScrollDirective } = await import(pathToFileURL(dirBundle).href);
const { NgZone } = await import(pathToFileURL(coreStub).href);

/** The reference numbers a rendered string shows, in order: ['1','1','2']. */
const markerNumbers = html => [...html.matchAll(/<sup class="qp-cite">.*?>\[(\d+)\]<\/a><\/sup>/g)].map(m => m[1]);

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ── fixtures ─────────────────────────────────────────────────────────── */

const REFS = mergeCitationRows([
  { module: 'sentiment', refs: {
    'SEN-12': { source: 'Reuters', url: 'https://www.reuters.com/markets/tsla-a', as_of: '2026-08-14', as_of_kind: 'published', type: 'news', ref: 'r1' },
    'SEN-13': { source: 'Reuters (same story)', url: 'https://www.reuters.com/markets/tsla-a/', as_of: '2026-08-14', as_of_kind: 'published', type: 'news' },
  } },
  { module: 'fs', refs: {
    'FS-Q10': { source: 'Tesla 10-Q Q2 2026', url: 'https://www.sec.gov/Archives/tsla-10q.htm', as_of: '2026-07-23', as_of_kind: 'filed', type: '10-Q' },
  } },
  // the site names this section 'financial' while the DB says 'fs' — merging
  // ignores the module name entirely, so both land in the same map
  { module: 'financial', refs: {
    'MAC-F6': { source: 'FRED — CPI', url: 'https://fred.stlouisfed.org/series/CPIAUCSL', as_of: '2026-08-01', as_of_kind: 'observation', type: 'series' },
  } },
  { module: 'price', refs: { 'PRC-1': { source: 'Internal quant run', as_of: '2026-08-18', type: 'model' } } },
  { module: 'junk', refs: null },
  null,
]);

/* ── tests ────────────────────────────────────────────────────────────── */

test('merge: all module rows collapse into one tag map, malformed rows ignored', () => {
  assert.deepEqual(Object.keys(REFS).sort(), ['FS-Q10', 'MAC-F6', 'PRC-1', 'SEN-12', 'SEN-13']);
  assert.equal(REFS['MAC-F6'].source, 'FRED — CPI');
});

test('numbering is by FIRST APPEARANCE across the page, not by tag order', () => {
  const texts = [
    'Headline cites the filing [FS-Q10].',            // → 1
    'Narrative cites the wire [SEN-12] and CPI [MAC-F6].', // → 2, 3
    'A later section re-cites the filing [FS-Q10].',   // → 1 again
  ];
  const idx = buildCitationIndex(texts, REFS);
  assert.deepEqual(idx.numbers, { 'FS-Q10': 1, 'SEN-12': 2, 'MAC-F6': 3 });
  assert.deepEqual(idx.entries.map(e => [e.n, e.source]), [
    [1, 'Tesla 10-Q Q2 2026'], [2, 'Reuters'], [3, 'FRED — CPI'],
  ]);
});

test('same SOURCE (same url) under different tags = ONE reference entry', () => {
  // SEN-12 and SEN-13 differ only by a trailing slash on the url
  const idx = buildCitationIndex(['First [SEN-12], then [SEN-13], then [FS-Q10].'], REFS);
  assert.equal(idx.entries.length, 2, 'reuters must not be listed twice');
  assert.equal(idx.numbers['SEN-12'], 1);
  assert.equal(idx.numbers['SEN-13'], 1, 'the duplicate url reuses number 1');
  assert.equal(idx.numbers['FS-Q10'], 2, 'the next distinct source is 2, not 3');
  assert.deepEqual(idx.entries[0].tags, ['SEN-12', 'SEN-13']);
});

test('urlless refs still get an entry, deduped on source + as_of', () => {
  const idx = buildCitationIndex(['[PRC-1] and again [PRC-1]'], REFS);
  assert.equal(idx.entries.length, 1);
  assert.equal(idx.entries[0].url, null);
  assert.equal(idx.entries[0].urlLabel, null);
});

test('unresolved tag: no number, muted marker, no link, claim text intact', () => {
  const idx = buildCitationIndex(['Claim A [SEN-12]. Claim B [ZZZ-99].'], REFS);
  assert.equal(idx.numbers['ZZZ-99'], undefined);
  assert.equal(idx.entries.length, 1, 'an unknown tag never creates a reference');
  const html = annotateCitations('Claim A [SEN-12]. Claim B [ZZZ-99].', idx);
  assert.match(html, /Claim A <sup class="qp-cite"><a href="#qp-ref-1"/);
  assert.match(html, /Claim B <span class="qp-cite-unresolved" title="unverified source"/);
  assert.ok(!/href="#qp-ref-undefined"/.test(html), 'never a dead link');
  assert.ok(html.includes('Claim A ') && html.includes('Claim B '), 'claim text survives');
});

test('ordinary bracketed prose survives verbatim — [US-EU] is never turned into [?]', () => {
  // the grammar cannot tell a citation from prose, so an unresolved match MUST
  // keep the literal the writer typed
  const src = 'The [US-EU] deal lands in [FY-2025], not [Q3-2026].';
  const idx = buildCitationIndex([src], REFS);
  assert.equal(idx.entries.length, 0, 'prose brackets never create references');
  const html = annotateCitations(src, idx);
  assert.ok(!html.includes('[?]'), 'no anonymous question mark ever replaces text');
  // these two match the grammar → muted span, but keep their own text
  for (const literal of ['[US-EU]', '[FY-2025]']) {
    assert.ok(html.includes(`>${literal}</span>`), `${literal} survives as its own text`);
  }
  // [Q3-2026] never matched the grammar in the first place — untouched
  assert.ok(html.includes(' not [Q3-2026].'), '[Q3-2026] is left completely alone');
  assert.equal(
    html.replace(/<[^>]+>/g, ''), src,
    'stripping our markup returns the original sentence, character for character',
  );
  assert.ok(!html.includes('<sup'), 'prose is not raised into a reference marker');
});

test('a model-minted pseudo-tag stays legible: muted, its own text, never a link', () => {
  const src = 'Per [RB-Apr] and [SEN-12], …';
  const html = annotateCitations(src, buildCitationIndex([src], REFS));
  assert.match(html, /<span class="qp-cite-unresolved" title="unverified source" data-tag="RB-Apr">\[RB-Apr\]<\/span>/);
  assert.ok(!/<a[^>]*>\[RB-Apr\]/.test(html), 'an unverified source is never a link');
  // …while the resolved one still gets its number
  assert.match(html, /<sup class="qp-cite"><a href="#qp-ref-1"[^>]*>\[1\]<\/a><\/sup>/);
});

test('References list shows only the entries cited by prose that is on screen', () => {
  // page-wide numbering: 1 = filing (summary), 2 = wire (tab one), 3 = CPI (tab two)
  const all = ['Summary cites [FS-Q10].', 'Tab one cites [SEN-12].', 'Tab two cites [MAC-F6].'];
  const idx = buildCitationIndex(all, REFS);
  assert.deepEqual(idx.entries.map(e => e.n), [1, 2, 3]);

  assert.deepEqual(citedEntries(idx, [all[0], all[1]]).map(e => e.n), [1, 2],
    'the closed tab’s source is not listed');
  assert.deepEqual(citedEntries(idx, [all[0], all[2]]).map(e => e.n), [1, 3],
    'numbers do NOT reshuffle when the reader switches tabs');
  assert.deepEqual(citedEntries(idx, ['no tags here']), [],
    'nothing cited on screen → no orphan bibliography');
  assert.deepEqual(citedEntries(idx, ['Only [ZZZ-99] here']), [],
    'an unresolved tag never lists a source');
  assert.deepEqual(citedEntries(EMPTY_CITATION_INDEX, all), []);
  assert.deepEqual(citedEntries(null, all), []);
});

test('every occurrence of a numbered tag is replaced, tags are case-normalised', () => {
  const idx = buildCitationIndex(['[SEN-12] x [SEN-12]'], REFS);
  const html = annotateCitations('[SEN-12] x [SEN-12]', idx);
  assert.equal((html.match(/qp-ref-1/g) || []).length, 2);
});

test('zero tags → text is returned untouched (graceful no-op)', () => {
  const plain = 'No citations here at all — [GAP: missing] and [lowercase-1] stay put.';
  const idx = buildCitationIndex([plain], REFS);
  assert.equal(idx, EMPTY_CITATION_INDEX);
  assert.equal(annotateCitations(plain, idx), plain);
});

test('no refs at all (fetch failed → {}) → every tag renders as unresolved, nothing breaks', () => {
  const src = 'Claim [SEN-12].';
  const idx = buildCitationIndex([src], {});
  assert.equal(idx.entries.length, 0);
  assert.match(annotateCitations(src, idx), /qp-cite-unresolved/);
  assert.match(annotateCitations(src, null), /qp-cite-unresolved/);
});

test('only http(s) urls become hrefs; hostile refs degrade to an unlinked entry', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,<script>'), null);
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  const hostile = mergeCitationRows([{ refs: {
    'XX-1': { source: 'Evil" onmouseover="alert(1)', url: 'javascript:alert(1)', as_of: '2026-01-01' },
  } }]);
  const idx = buildCitationIndex(['[XX-1]'], hostile);
  assert.equal(idx.entries[0].url, null);
  const html = annotateCitations('[XX-1]', idx);
  assert.ok(!html.includes('javascript:'), 'no javascript: anywhere in the marker');
  assert.ok(!html.includes('onmouseover="'), 'quotes in the source are attribute-escaped');
  assert.match(html, /title="Evil&quot; onmouseover=&quot;alert\(1\) — as of 2026-01-01"/);
});

test('renderCitedText escapes model HTML before injecting markers', () => {
  const idx = buildCitationIndex(['[SEN-12]'], REFS);
  const html = renderCitedText('<img src=x onerror=alert(1)> cited [SEN-12]', idx);
  assert.ok(!html.includes('<img'), 'model HTML is inert');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<sup class="qp-cite"><a href="#qp-ref-1"/);
});

test('reference line fields match the spec: source — url, as of {as_of} ({type})', () => {
  const idx = buildCitationIndex(['[FS-Q10]'], REFS);
  const e = idx.entries[0];
  assert.deepEqual(
    [e.n, e.source, e.url, e.urlLabel, e.asOf, e.asOfKind, e.type],
    [1, 'Tesla 10-Q Q2 2026', 'https://www.sec.gov/Archives/tsla-10q.htm',
     'sec.gov/Archives/tsla-10q.htm', '2026-07-23', 'filed', '10-Q'],
  );
});

test('run-date key: the analysis run_at maps to its OWN citation_refs.run_date', () => {
  // exactly what PostgREST returns for stock_analyses.run_at (timestamptz),
  // and exactly what citation_refs.run_date holds for that same run
  assert.equal(citationRunDateKey('2026-08-19T00:00:00+00:00'), '2026-08-19');
  assert.equal(citationRunDateKey('2026-08-19T00:00:00Z'), '2026-08-19');
  assert.equal(citationRunDateKey('2026-08-19'), '2026-08-19');
  // a UTC-midnight run must NOT be dragged into the previous day by tz maths
  assert.equal(citationRunDateKey('2026-08-19T00:00:00.123456+00:00'), '2026-08-19');
  // a non-UTC offset is converted to UTC, not truncated
  assert.equal(citationRunDateKey('2026-08-19T01:00:00+02:00'), '2026-08-18');
  // no date → null → the caller must return {} rather than guess a day
  assert.equal(citationRunDateKey(null), null);
  assert.equal(citationRunDateKey(''), null);
  assert.equal(citationRunDateKey('latest'), null);
});

/* ── marker runs: duplicates collapse, pile-ups are capped ─────────────── */

// Adjacent-marker fixtures. MGT-4 and MGT-45 are two chunks of ONE proxy
// statement (the live management-page bug: 46 of 59 runs repeated a number);
// POL-31 is the same tag written twice by the model.
const RUN_REFS = mergeCitationRows([{ refs: {
  'MGT-4':  { source: 'Tesla DEF 14A 2026', url: 'https://www.sec.gov/def14a.htm', as_of: '2026-04-30', type: 'DEF 14A' },
  'MGT-45': { source: 'Tesla DEF 14A 2026 (comp table)', url: 'https://www.sec.gov/def14a.htm#comp', as_of: '2026-04-30', type: 'DEF 14A' },
  'POL-31': { source: 'Quiver — lobbying', url: 'https://www.quiverquant.com/lobbying/TSLA', as_of: '2026-05-02', type: 'lobbying' },
  'POL-32': { source: 'OpenSecrets', url: 'https://www.opensecrets.org/orgs/tesla', as_of: '2026-05-02', type: 'lobbying' },
  'POL-33': { source: 'Senate LDA filing', url: 'https://lda.senate.gov/filing/1', as_of: '2026-04-20', type: 'filing' },
} }]);
// MGT-4 and MGT-45 differ only by a #fragment → normalizeUrl collapses them
// into ONE entry, which is exactly cause (a): different tags, same reference.

test('run: two tags that resolve to the SAME reference render ONE marker', () => {
  const src = 'Pay rose sharply [MGT-4][MGT-45].';
  const idx = buildCitationIndex([src], RUN_REFS);
  assert.equal(idx.entries.length, 1, 'one proxy statement = one reference');
  const html = annotateCitations(src, idx);
  assert.deepEqual(markerNumbers(html), ['1'], 'the reader sees [1], never [1][1]');
  // the reference itself still credits BOTH tags, and is still listed
  assert.deepEqual(idx.entries[0].tags, ['MGT-4', 'MGT-45']);
  assert.deepEqual(citedEntries(idx, [src]).map(e => e.n), [1]);
  assert.ok(html.startsWith('Pay rose sharply <sup') && html.endsWith('</sup>.'),
    'the surrounding sentence is untouched');
});

test('run: the SAME tag written twice collapses to one marker', () => {
  const src = 'Lobbying spend climbed [POL-31][POL-31].';
  const idx = buildCitationIndex([src], RUN_REFS);
  assert.deepEqual(markerNumbers(annotateCitations(src, idx)), ['1']);
});

test('run: a dropped marker takes its separator with it — no stranded comma', () => {
  const src = 'Spend climbed [POL-31], [POL-31] again.';
  const idx = buildCitationIndex([src], RUN_REFS);
  const html = annotateCitations(src, idx);
  assert.deepEqual(markerNumbers(html), ['1']);
  assert.equal(html.replace(/<[^>]+>/g, ''), 'Spend climbed [1] again.');
});

test('run: distinct markers keep their own separator when nothing is dropped', () => {
  const src = 'Both agree [POL-31], [POL-32].';
  const idx = buildCitationIndex([src], RUN_REFS);
  const html = annotateCitations(src, idx);
  assert.deepEqual(markerNumbers(html), ['1', '2']);
  assert.equal(html.replace(/<[^>]+>/g, ''), 'Both agree [1], [2].');
});

test('run of 19 markers is capped at CITATION_RUN_MAX, every source still listed', () => {
  // 19 tags, 6 distinct sources, MAC-R1 repeated 11× — the worst live shape.
  const refs = mergeCitationRows([{ refs: Object.fromEntries(
    ['R1', 'F17', 'F44', 'F47', 'F53', 'F61'].map(k =>
      [`MAC-${k}`, { source: `FRED ${k}`, url: `https://fred.stlouisfed.org/series/${k}`, as_of: '2026-08-01', type: 'series' }]),
  ) }]);
  const tags = [
    'MAC-R1', 'MAC-R1', 'MAC-F17', 'MAC-R1', 'MAC-F44', 'MAC-R1', 'MAC-R1',
    'MAC-F47', 'MAC-R1', 'MAC-R1', 'MAC-F53', 'MAC-R1', 'MAC-R1', 'MAC-F61',
    'MAC-R1', 'MAC-R1', 'MAC-R1', 'MAC-R1', 'MAC-R1',
  ];
  assert.equal(tags.length, 19);
  const src = `Rates stayed restrictive ${tags.map(t => `[${t}]`).join('')} through the quarter.`;
  const idx = buildCitationIndex([src], refs);
  assert.equal(idx.entries.length, 6, 'all six sources are numbered');

  // the six sources are numbered 1..6, so the run FOLDS before any cap applies
  const html = annotateCitations(src, idx);
  assert.equal(html.replace(/<[^>]+>/g, ''), 'Rates stayed restrictive [1–6] through the quarter.',
    '19 markers become one folded range; the prose around it is byte-identical');
  assert.match(html, /data-range="1,2,3,4,5,6"/);
  assert.ok(!html.includes('data-more='), 'folding left nothing for the cap to drop');
  assert.deepEqual(citedEntries(idx, [src]).map(e => e.n), [1, 2, 3, 4, 5, 6],
    'every source in the run is still in the References list');
});

test('run of non-consecutive references is capped at CITATION_RUN_MAX, every source still listed', () => {
  // numbers 1,3,5,7,9 — nothing to fold, so the old cap behaviour holds
  const refs = mergeCitationRows([{ refs: Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`MAC-F${i + 1}`,
      { source: `FRED ${i + 1}`, url: `https://fred.stlouisfed.org/series/S${i + 1}`, type: 'series' }]),
  ) }]);
  const intro = 'Intro [MAC-F1] a [MAC-F2] b [MAC-F3] c [MAC-F4] d [MAC-F5] e [MAC-F6] f [MAC-F7] g [MAC-F8] h [MAC-F9] i [MAC-F10].';
  const src = 'Run [MAC-F9][MAC-F1][MAC-F5][MAC-F3][MAC-F7] end.';
  const idx = buildCitationIndex([intro, src], refs);
  const html = annotateCitations(src, idx);
  assert.deepEqual(markerNumbers(html), ['9', '1', '5'], 'the FIRST distinct three, in the order written');
  assert.match(html, /data-more="3,7"/);
  assert.deepEqual(citedEntries(idx, [src]).map(e => e.n), [1, 3, 5, 7, 9]);
});

test('run: capping counts DISTINCT references, not raw markers', () => {
  const src = '[POL-31][POL-31][POL-32][POL-32][POL-33][POL-33]';
  const idx = buildCitationIndex([src], RUN_REFS);
  const html = annotateCitations(src, idx);
  assert.equal(html.replace(/<[^>]+>/g, ''), '[1–3]', 'six markers, three references, folded, none capped away');
  assert.ok(!html.includes('data-more='), 'nothing was dropped by the cap');
});

test('a single marker is rendered exactly as before — no collapse machinery leaks', () => {
  const src = 'Revenue beat [SEN-12] on the quarter.';
  const idx = buildCitationIndex([src], REFS);
  const html = annotateCitations(src, idx);
  assert.equal(
    html,
    'Revenue beat <sup class="qp-cite"><a href="#qp-ref-1" class="qp-cite-link"' +
    ' title="Reuters — as of 2026-08-14 (news)" data-tag="SEN-12">[1]</a></sup> on the quarter.',
  );
  assert.ok(!html.includes('data-more='), 'no extra attribute on an uncollapsed marker');
});

test('markers separated by real words or a table pipe are NOT one run', () => {
  const idx = buildCitationIndex(['[POL-31] x [POL-31]'], RUN_REFS);
  assert.deepEqual(markerNumbers(annotateCitations('[POL-31] x [POL-31]', idx)), ['1', '1'],
    'prose between them means they are not adjacent on screen');
  // a markdown table column of the same tag must keep one marker per cell
  const row = '| CPI [POL-31] | PPI [POL-31] |';
  assert.deepEqual(markerNumbers(annotateCitations(row, idx)), ['1', '1']);
  // a blank line is a paragraph break — never a run
  assert.deepEqual(markerNumbers(annotateCitations('[POL-31]\n\n[POL-31]', idx)), ['1', '1']);
  // …but a single wrapped line IS the same sentence to the reader
  assert.deepEqual(markerNumbers(annotateCitations('[POL-31]\n[POL-31]', idx)), ['1']);
});

test('an unresolved tag breaks a run and is never collapsed away', () => {
  const src = 'Claim [POL-31][ZZ-9][POL-31] holds.';
  const idx = buildCitationIndex([src], RUN_REFS);
  const html = annotateCitations(src, idx);
  assert.deepEqual(markerNumbers(html), ['1', '1'], 'the muted literal sits between them');
  assert.equal(html.replace(/<[^>]+>/g, ''), 'Claim [1][ZZ-9][1] holds.',
    'the unresolved tag keeps its own text');
});

test('collapsing survives the markdown path and renderCitedText alike', () => {
  const src = 'Pay rose [MGT-4][MGT-45].';
  const idx = buildCitationIndex([src], RUN_REFS);
  assert.deepEqual(markerNumbers(renderCitedText(src, idx)), ['1']);
});

/* ── click target (CitationScrollDirective) ───────────────────────────── */

test('a marker\'s own href is recognised as an in-page citation anchor', () => {
  // the exact href annotateCitations emits — the directive reads the RAW
  // attribute, so this is the string it actually sees
  const src = 'Revenue beat [SEN-12].';
  const idx = buildCitationIndex([src], REFS);
  const href = /href="([^"]+)"/.exec(annotateCitations(src, idx))[1];
  assert.equal(href, `#${CITATION_ANCHOR_PREFIX}1`);
  assert.equal(citationAnchorTarget(href), `${CITATION_ANCHOR_PREFIX}1`,
    'the id returned is exactly what ReferencesComponent puts on the <li>');
});

test('an already-resolved href still resolves to the same entry id', () => {
  // <base href="/"> is what makes the browser hand back an absolute url here;
  // the directive must recognise its own anchor either way
  assert.equal(citationAnchorTarget('https://stockbar.app/stock/TSLA/management#qp-ref-12'), 'qp-ref-12');
  assert.equal(citationAnchorTarget('/stock/TSLA#qp-ref-3'), 'qp-ref-3');
});

test('every other link is left to the browser — no href is hijacked', () => {
  for (const href of [
    'https://www.reuters.com/markets/tsla-a',  // a References-list source link
    '#chain-4',                                // factor page chain anchor
    '#section-references',                     // TOC anchor
    '/stock/TSLA/management',                  // a routerLink
    '',
    null,
    undefined,
  ]) {
    assert.equal(citationAnchorTarget(href), null, `must not claim ${JSON.stringify(href)}`);
  }
});

test('only prefix + digits is claimed — nothing else can be smuggled into an id', () => {
  // the ids in the DOM are prefix + reference number and nothing else, so a
  // near-miss fragment must fall through rather than be looked up
  assert.equal(citationAnchorTarget('#qp-ref-'), null);
  assert.equal(citationAnchorTarget('#qp-ref-3x'), null);
  assert.equal(citationAnchorTarget('#qp-ref-3 '), null);
  assert.equal(citationAnchorTarget('#qp-ref-x"><img src=x onerror=alert(1)>'), null);
  assert.equal(citationAnchorTarget('#qp-reference-3'), null);
  assert.equal(citationAnchorTarget('#QP-REF-3'), null, 'ids are case-sensitive');
  assert.equal(citationAnchorTarget('#qp-ref-10'), 'qp-ref-10', 'multi-digit numbers still work');
});

test('a capped run still points its surviving markers at real entries', () => {
  // data-more numbers are NOT rendered as links; whatever IS rendered must be
  // claimable by the click handler
  const src = '[POL-31][POL-33][MGT-4][POL-32]';
  const idx = buildCitationIndex(['[MGT-4] x [POL-32] y [POL-31] z [POL-33]', src], RUN_REFS);
  // numbers: MGT-4=1, POL-32=2, POL-31=3, POL-33=4 → run {1,2,3,4} folds to [1–4]
  const folded = [...annotateCitations(src, idx).matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(folded, ['#qp-ref-1'], 'a folded range links to its first reference');
  for (const h of folded) assert.ok(citationAnchorTarget(h));
  // a run that cannot fold keeps the cap: 4 distinct, non-consecutive
  const refs = mergeCitationRows([{ refs: Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7].map(i => [`XX-${i}`, { source: `S${i}`, url: `https://ex.com/${i}` }])) }]);
  const idx2 = buildCitationIndex(['[XX-1] a [XX-2] b [XX-3] c [XX-4] d [XX-5] e [XX-6] f [XX-7]'], refs);
  const hrefs = [...annotateCitations('[XX-1][XX-3][XX-5][XX-7]', idx2).matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.equal(hrefs.length, CITATION_RUN_MAX);
  for (const h of hrefs) assert.ok(citationAnchorTarget(h), `${h} must be handled in-page`);
});

/* ── range folding, passages, prediction markets (2026-10-03) ─────────── */

const FOLD_REFS = mergeCitationRows([{ refs: Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [`POL-${i + 1}`,
    { source: `Article ${i + 1}`, url: `https://news.example.com/a${i + 1}`, type: 'news' }]),
) }]);
const FOLD_INTRO = '[POL-1][POL-2] intro [POL-3] x [POL-4] y [POL-5] z [POL-6] w [POL-7] v [POL-8] u [POL-9].';

test('fold: [3][4][5] renders as one [3–5] marker linked to the first', () => {
  const idx = buildCitationIndex([FOLD_INTRO], FOLD_REFS);
  const html = annotateCitations('Claim [POL-3][POL-4][POL-5].', idx);
  assert.equal(html.replace(/<[^>]+>/g, ''), 'Claim [3–5].');
  assert.match(html, /href="#qp-ref-3"/);
  assert.match(html, /data-range="3,4,5"/);
  assert.ok(citationAnchorTarget('#qp-ref-3'));
});

test('fold: writer order does not matter, repeats collapse, the rest stays separate', () => {
  const idx = buildCitationIndex([FOLD_INTRO], FOLD_REFS);
  const html = annotateCitations('Claim [POL-5], [POL-3][POL-9][POL-4][POL-3].', idx);
  assert.equal(html.replace(/<[^>]+>/g, ''), 'Claim [3–5][9].');
});

test('fold: two consecutive numbers are NOT folded — [3][4] is as short as [3–4]', () => {
  const idx = buildCitationIndex([FOLD_INTRO], FOLD_REFS);
  const html = annotateCitations('Claim [POL-3][POL-4].', idx);
  assert.deepEqual(markerNumbers(html), ['3', '4']);
  assert.ok(!html.includes('data-range'));
});

test('fold first, then cap: units are capped, not raw numbers', () => {
  const idx = buildCitationIndex([FOLD_INTRO], FOLD_REFS);
  // {1,2,3} {5} {7} {9}: four units → the cap keeps three, drops 9
  const html = annotateCitations('[POL-1][POL-2][POL-3][POL-5][POL-7][POL-9]', idx);
  assert.equal(html.replace(/<[^>]+>/g, ''), '[1–3][5][7]');
  assert.match(html, /data-more="9"/);
  assert.equal(CITATION_RUN_MAX, 3);
});

test('passages: a reference grouping several tags reports N distinct passages', () => {
  const refs = mergeCitationRows([{ refs: {
    'POL-31': { source: 'Reuters', url: 'https://www.reuters.com/x', ref: 'doc-1' },
    'POL-32': { source: 'Reuters', url: 'https://www.reuters.com/x', ref: 'doc-1' },
    'POL-33': { source: 'Reuters', url: 'https://reuters.com/x/'.replace('reuters', 'www.reuters'), ref: 'doc-1' },
    'POL-40': { source: 'AP', url: 'https://apnews.com/y' },
  } }]);
  const idx = buildCitationIndex(['a [POL-31] b [POL-32] c [pol-31] d [POL-33] e [POL-40]'], refs);
  assert.equal(idx.entries.length, 2);
  assert.equal(passageCount(idx.entries[0]), 3, 'three distinct chunk tags, one repeated in lower case');
  assert.equal(passageCount(idx.entries[1]), 1);
});

test('polymarket: different markets under ONE event url are separate references', () => {
  const refs = mergeCitationRows([{ module: 'political', refs: {
    'PM-1': { ref: 'PM:will-delcy-rodrguez-be-the-leader-of-venezuela-end-of-2026', url: 'https://polymarket.com/event/venezuela-leader-end-of-2026', type: 'prediction-market', source: 'Polymarket', as_of: '2026-09-20T16:54:20Z' },
    'PM-2': { ref: 'PM:will-nicols-maduro-be-the-leader-of-venezuela-end-of-2026', url: 'https://polymarket.com/event/venezuela-leader-end-of-2026', type: 'prediction-market', source: 'Polymarket', as_of: '2026-09-20T16:54:20Z' },
    'PM-9': { ref: 'PM:will-nicols-maduro-be-the-leader-of-venezuela-end-of-2026', url: 'https://polymarket.com/event/venezuela-leader-end-of-2026/', type: 'prediction-market', source: 'Polymarket' },
    'PM-11': { ref: 'PM:us-x-iran-ceasefire-continues-through-september-20-20260917', url: 'https://polymarket.com/event/us-iran-ceasefire', type: 'prediction-market', source: 'Polymarket' },
    'PM-14': { ref: 'PM:bab-el-mandeb-strait-effectively-closed-by-september-30-999-671-939', url: 'https://polymarket.com/event/bab', source: 'Polymarket' },
    'POL-1': { ref: 'art-1', url: 'https://www.reuters.com/z', type: 'news', source: 'Reuters' },
    'POL-2': { ref: 'art-1-chunk-2', url: 'https://www.reuters.com/z', type: 'news', source: 'Reuters' },
  } }]);
  const idx = buildCitationIndex(['[PM-1] vs [PM-2] and again [PM-9]; [PM-11] [PM-14] news [POL-1] [POL-2]'], refs);
  const n = idx.numbers;
  assert.notEqual(n['PM-1'], n['PM-2'], 'two markets, two numbers — no contradictory odds under one');
  assert.equal(n['PM-2'], n['PM-9'], 'the SAME market cited twice is still one reference');
  assert.equal(n['POL-1'], n['POL-2'], 'articles still dedupe on the url alone');
  const byN = Object.fromEntries(idx.entries.map(e => [e.n, e]));
  assert.equal(byN[n['PM-1']].question, 'Will delcy rodrguez be the leader of venezuela end of 2026?');
  assert.equal(byN[n['PM-11']].question, 'Us x iran ceasefire continues through september 20', 'date id suffix dropped');
  assert.equal(byN[n['PM-14']].question, 'Bab el mandeb strait effectively closed by september 30', 'PM: ref alone marks a market');
  assert.equal(byN[n['POL-1']].question, null, 'non-market refs carry no question');
  assert.equal(marketQuestion('PM:will-the-us-invade-iran-before-2027'), 'Will the us invade iran before 2027?', 'years survive');
  assert.equal(marketQuestion(null), null);
});

/* ── the click handler (CitationScrollDirective) ──────────────────────── */

/** Just enough DOM for the handler: the bits it actually calls, each one
 *  recording what it was asked to do. */
function makeEl(id, tag = 'li') {
  const attrs = {};
  const el = {
    id, tagName: tag.toUpperCase(), offsetWidth: 1,
    classes: new Set(), focused: false, focusOpts: null, scrolled: null,
    classList: {
      add: c => el.classes.add(c), remove: c => el.classes.delete(c),
      contains: c => el.classes.has(c),
    },
    getAttribute: k => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    hasAttribute: k => k in attrs,
    focus: o => { el.focused = true; el.focusOpts = o; },
    scrollIntoView: o => { el.scrolled = o; },
    // the marker is a <sup><a>…</a></sup>, so the click target is the anchor's
    // own text node's parent — closest('a') is what finds the link
    closest: sel => (sel === 'a' && el.tagName === 'A' ? el : el.parentAnchor ?? null),
  };
  return el;
}

/** A page at /stock/TSLA/management with a two-entry References list. */
function clickWorld({ href = '#qp-ref-2', reduce = false } = {}) {
  const entries = { 'qp-ref-1': makeEl('qp-ref-1'), 'qp-ref-2': makeEl('qp-ref-2') };
  const replaced = [];
  const win = {
    matchMedia: q => ({ matches: reduce && /reduce/.test(q) }),
    location: { pathname: '/stock/TSLA/management', search: '' },
    history: { state: { navId: 7 }, length: 4, replaceState: (st, ttl, url) => replaced.push(url) },
  };
  const doc = { defaultView: win, getElementById: id => entries[id] ?? null };
  const anchor = makeEl(null, 'a');
  anchor.setAttribute('href', href);
  const sup = makeEl(null, 'sup');
  sup.parentAnchor = anchor;
  let prevented = 0;
  return {
    entries, replaced, win,
    directive: new CitationScrollDirective(doc, 'browser', new NgZone()),
    event: { target: sup, defaultPrevented: false, preventDefault: () => { prevented++; } },
    prevented: () => prevented,
  };
}

test('click: the marker is cancelled and the entry is scrolled to in-page', () => {
  const w = clickWorld();
  w.directive.onClick(w.event);
  assert.equal(w.prevented(), 1, 'preventDefault — the bug was a navigation to the home route');
  assert.deepEqual(w.entries['qp-ref-2'].scrolled, { behavior: 'smooth', block: 'start' });
  assert.equal(w.entries['qp-ref-1'].scrolled, null, 'only the clicked entry moves');
});

test('click: keyboard focus follows the jump, without a second scroll', () => {
  const w = clickWorld();
  w.directive.onClick(w.event);
  const el = w.entries['qp-ref-2'];
  assert.equal(el.focused, true, 'the reader\'s keyboard position follows them down');
  assert.deepEqual(el.focusOpts, { preventScroll: true }, 'focus must not cancel the smooth scroll');
});

test('click: the address bar is REPLACED, never pushed — back button unaffected', () => {
  const w = clickWorld();
  w.directive.onClick(w.event);
  assert.deepEqual(w.replaced, ['/stock/TSLA/management#qp-ref-2']);
  assert.equal(w.win.history.length, 4, 'no history entry added');
});

test('click: the entry flashes, and the highlight is cleaned up', () => {
  const w = clickWorld();
  w.directive.onClick(w.event);
  assert.ok(w.entries['qp-ref-2'].classList.contains('qp-ref-flash'));
  w.directive.ngOnDestroy();
  assert.ok(!w.entries['qp-ref-2'].classList.contains('qp-ref-flash'));
});

test('click: prefers-reduced-motion jumps instantly, still without navigating', () => {
  const w = clickWorld({ reduce: true });
  w.directive.onClick(w.event);
  assert.deepEqual(w.entries['qp-ref-2'].scrolled, { behavior: 'auto', block: 'start' });
  assert.equal(w.prevented(), 1);
});

test('click: every other link on the page is left alone', () => {
  for (const href of ['https://www.reuters.com/markets/tsla-a', '#chain-4', '/stock/TSLA']) {
    const w = clickWorld({ href });
    w.directive.onClick(w.event);
    assert.equal(w.prevented(), 0, `${href} must still behave like a normal link`);
    assert.deepEqual(w.replaced, [], 'and must not touch the url');
  }
});

test('click: a marker whose entry is not on screen still never navigates', () => {
  const w = clickWorld({ href: '#qp-ref-9' });
  w.directive.onClick(w.event);
  assert.equal(w.prevented(), 1, 'doing nothing beats landing on the home page');
  assert.deepEqual(w.replaced, [], 'the url is left exactly as it was');
});

test('click: SSR — the handler touches no DOM when the platform is not a browser', () => {
  const w = clickWorld();
  const exploding = {
    get defaultView() { throw new Error('DOM read during server rendering'); },
    getElementById() { throw new Error('DOM read during server rendering'); },
  };
  new CitationScrollDirective(exploding, 'server', new NgZone()).onClick(w.event);
  assert.equal(w.prevented(), 0);
});

/* ── runner ───────────────────────────────────────────────────────────── */

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err.message.split('\n').join('\n       ')}`);
  }
}
rmSync(out, { recursive: true, force: true });
console.log(`\n${passed}/${tests.length} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
