/**
 * Node-runnable test for the pure citation logic (src/app/services/citations.ts).
 *
 *   node tools/citations.test.mjs
 *
 * No karma, no browser: the module is deliberately Angular-free, so it is
 * transpiled with the esbuild already in node_modules and imported directly.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
  EMPTY_CITATION_INDEX, safeUrl, citationRunDateKey,
} = await import(pathToFileURL(bundle).href);

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
  assert.match(html, /Claim B <sup class="qp-cite qp-cite-unresolved" title="unverified source"/);
  assert.ok(!/href="#qp-ref-undefined"/.test(html), 'never a dead link');
  assert.ok(html.includes('Claim A ') && html.includes('Claim B '), 'claim text survives');
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
