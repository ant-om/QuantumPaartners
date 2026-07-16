import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AppServerModule from './main.server';
import { environment } from './environments/environment';
import { FACTORS } from './app/models/factors';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

const app = express();
const commonEngine = new CommonEngine({ allowedHosts: ['stockbar.app'] });

/**
 * /sitemap.xml — every page incl. the 7 factor URLs per ticker,
 * lastmod from the analysis run_at, cached in memory for ~1h.
 */
const SITE_ORIGIN = 'https://stockbar.app';
let sitemapCache: { xml: string; at: number } | null = null;
const SITEMAP_TTL_MS = 60 * 60 * 1000;

async function buildSitemap(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const urls: { loc: string; lastmod: string }[] = [
    { loc: '/', lastmod: today },
    { loc: '/about', lastmod: today },
    { loc: '/newsletter', lastmod: today },
  ];
  try {
    const res = await fetch(
      `${environment.supabaseUrl}/rest/v1/stocks?select=ticker,stock_analyses(run_at)&order=ticker`,
      { headers: { apikey: environment.supabaseAnonKey, Authorization: `Bearer ${environment.supabaseAnonKey}` } },
    );
    if (res.ok) {
      const rows = (await res.json()) as { ticker: string; stock_analyses?: { run_at: string }[] }[];
      for (const row of rows) {
        const lastmod = (row.stock_analyses?.[0]?.run_at ?? today).slice(0, 10);
        urls.push({ loc: `/stock/${row.ticker}`, lastmod });
        for (const f of FACTORS) urls.push({ loc: `/stock/${row.ticker}/${f.slug}`, lastmod });
      }
    }
  } catch {
    // stocks unavailable — serve the static pages only
  }
  const body = urls
    .map(u => `  <url><loc>${SITE_ORIGIN}${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** /api/newsletter/latest — latest newsletter edition for the /newsletter page.
 *  Requires EDITIONS_SUPABASE_KEY in the server environment; returns 204 when
 *  unset (the page hides the section). Cached ~15 min. */
let editionCache: { body: unknown; at: number } | null = null;

app.get('/api/newsletter/latest', async (req, res) => {
  const editionsKey = process.env['EDITIONS_SUPABASE_KEY'] ?? '';
  if (!editionsKey) {
    res.status(204).end();
    return;
  }
  if (editionCache && Date.now() - editionCache.at < 15 * 60 * 1000) {
    res.json(editionCache.body);
    return;
  }
  try {
    const url = process.env['EDITIONS_SUPABASE_URL'] ?? 'https://zxxpowkxwfweziabalqf.supabase.co';
    const r = await fetch(
      `${url}/rest/v1/editions?select=ticker,date,edition_text,word_count,generated_at&order=date.desc,generated_at.desc&limit=1`,
      { headers: { apikey: editionsKey, Authorization: `Bearer ${editionsKey}` } },
    );
    if (!r.ok) throw new Error(String(r.status));
    const rows = (await r.json()) as unknown[];
    if (!Array.isArray(rows) || !rows.length) {
      res.status(204).end();
      return;
    }
    editionCache = { body: rows[0], at: Date.now() };
    res.json(rows[0]);
  } catch {
    res.status(503).json({ error: 'editions unavailable' });
  }
});

app.get('/sitemap.xml', (req, res) => {
  const fresh = sitemapCache && Date.now() - sitemapCache.at < SITEMAP_TTL_MS;
  if (fresh) {
    res.type('application/xml').send(sitemapCache!.xml);
    return;
  }
  buildSitemap()
    .then(xml => {
      sitemapCache = { xml, at: Date.now() };
      res.type('application/xml').send(xml);
    })
    .catch(() => res.status(503).send(''));
});

/**
 * Serve static files from /browser
 */
app.get(
  '**',
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: 'index.html'
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.get('**', (req, res, next) => {
  const { originalUrl, baseUrl } = req;

  commonEngine
    .render({
      bootstrap: AppServerModule,
      documentFilePath: indexHtml,
      // fixed origin: never trust the Host header for rendering
      url: `${SITE_ORIGIN}${originalUrl}`,
      publicPath: browserDistFolder,
      providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
    })
    .then((html) => res.send(html))
    .catch((err) => next(err));
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export default app;
