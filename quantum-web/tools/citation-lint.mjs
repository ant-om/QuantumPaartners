/**
 * Post-run citation lint — does the LIVE published page actually cite anything?
 *
 *   node tools/citation-lint.mjs [TICKER]
 *
 * Reads the published analysis row and the citation_refs of ITS OWN run date
 * (the same exact-date pairing the site does), then runs the real
 * src/app/services/citations.ts over the row's prose and reports what a reader
 * would see: numbered links, grey unresolved markers, the References list, and
 * bracketed text that is not a tag at all.
 *
 * Read-only. Uses the anon keys already in src/environments/environment.ts.
 * Exit code 1 when the contract is broken for this run, so it can gate a
 * deploy or a post-cascade check.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, 'src/environments/environment.ts'), 'utf8');
const conf = k => {
  const m = new RegExp(`${k}\\s*:\\s*'([^']+)'`).exec(env);
  if (!m) throw new Error(`environment.ts has no ${k}`);
  return m[1];
};
const SITE = conf('supabaseUrl'), SITE_KEY = conf('supabaseAnonKey');
const ARCHIVE = conf('archiveSupabaseUrl'), ARCHIVE_KEY = conf('archiveAnonKey');
const ticker = (process.argv[2] || 'TSLA').toUpperCase();

const out = mkdtempSync(join(tmpdir(), 'qp-lint-'));
const bundle = join(out, 'citations.mjs');
execFileSync(
  join(root, 'node_modules/.bin/esbuild'),
  [join(root, 'src/app/services/citations.ts'), '--format=esm', '--target=es2022', `--outfile=${bundle}`],
  { stdio: 'pipe' },
);
const C = await import(pathToFileURL(bundle).href);

const get = async (base, key, path) => {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
};

const COLUMNS = ['summary', 'macro', 'political', 'financial', 'competitor', 'management', 'sentiment', 'price'];
const rows = await get(SITE, SITE_KEY,
  `stocks?select=ticker,stock_analyses(run_at,source,${COLUMNS.join(',')})&ticker=eq.${ticker}`);
const analysis = rows?.[0]?.stock_analyses?.[0];
if (!analysis) { console.error(`no published analysis for ${ticker}`); process.exit(1); }

const day = C.citationRunDateKey(analysis.run_at);
console.log(`${ticker}: run_at ${analysis.run_at} → refs key ${day} (source ${analysis.source})`);
if (!day) { console.error('run_at does not parse to a refs key — every tag will be grey'); process.exit(1); }

const refRows = await get(ARCHIVE, ARCHIVE_KEY,
  `citation_refs?select=module,refs&ticker=eq.${ticker}&run_date=eq.${day}`);
const refs = C.mergeCitationRows(refRows);
console.log(`citation_refs rows for ${day}: ${refRows.length}/7 modules` +
  ` (${refRows.map(r => `${r.module}:${Object.keys(r.refs ?? {}).length}`).join(' ')})`);

const texts = [];
const walk = v => {
  if (typeof v === 'string') texts.push(v);
  else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === 'object') Object.values(v).forEach(walk);
};
for (const c of COLUMNS) walk(analysis[c]);

const index = C.buildCitationIndex(texts, refs);
const tags = new Set();
for (const t of texts) {
  const re = C.citationTagRe();
  let m; while ((m = re.exec(t)) !== null) tags.add(`${m[1]}-${m[2]}`.toUpperCase());
}
const unresolved = [...tags].filter(t => index.numbers[t] === undefined);

let links = 0, grey = 0;
for (const t of texts) {
  const html = C.annotateCitations(t, index);
  links += (html.match(/class="qp-cite-link"/g) ?? []).length;
  grey += (html.match(/qp-cite-unresolved/g) ?? []).length;
}
// Bracketed prose that is not a tag prints literally — the L1 header leak.
const junk = new Map();
for (const t of texts) {
  for (const b of t.match(/\[[^\]\n]{1,80}\]/g) ?? []) {
    if (!/^\[[A-Z]{2,5}-[A-Za-z0-9]+\]$/.test(b)) junk.set(b, (junk.get(b) ?? 0) + 1);
  }
}
const cited = C.citedEntries(index, texts);
console.log(`page prose: ${texts.length} strings, ${tags.size} distinct tags`);
console.log(`resolved ${tags.size - unresolved.length}, unresolved ${unresolved.length}` +
  (unresolved.length ? ` → ${unresolved.sort().join(' ')}` : ''));
console.log(`rendered: ${links} numbered links, ${grey} grey markers, ${cited.length} References entries`);
console.log(`bracketed non-tag text (prints literally): ${[...junk.values()].reduce((a, b) => a + b, 0)}` +
  (junk.size ? ` → ${[...junk.keys()].slice(0, 8).join(' ')}` : ''));

const problems = [];
if (refRows.length < 7) problems.push(`only ${refRows.length}/7 citation_refs rows for ${day}`);
if (!tags.size) problems.push('the published row carries no citation tags at all');
if (tags.size && unresolved.length / tags.size > 0.1) problems.push(`${unresolved.length}/${tags.size} tags unresolved (>10%)`);
if (!links) problems.push('no tag on the page resolves to a numbered link');
if (problems.length) { console.error('\nFAIL\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('\nOK — the published run cites its own sources.');
