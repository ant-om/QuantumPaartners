import { Inject, Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';

export interface SeoConfig {
  title: string;
  description?: string;
  /** Path only (e.g. /stock/AAPL) — origin is prepended. */
  canonicalPath?: string;
  ogType?: 'website' | 'article';
  jsonLd?: object | object[];
  noindex?: boolean;
}

const ORIGIN = 'https://stockbar.app'; // update if the production domain changes
const SITE = 'Stock Bar';

/** Per-route titles, meta, canonical + JSON-LD. Call set() in every routed
 *  component's init — each call fully replaces the previous route's tags. */
@Injectable({ providedIn: 'root' })
export class SeoService {
  constructor(
    private title: Title,
    private meta: Meta,
    @Inject(DOCUMENT) private doc: Document,
  ) {}

  set(cfg: SeoConfig): void {
    const fullTitle = cfg.title.includes(SITE) ? cfg.title : `${cfg.title} | ${SITE}`;
    this.title.setTitle(fullTitle);

    this.upsert('description', cfg.description ?? '');
    this.upsertProp('og:title', fullTitle);
    this.upsertProp('og:description', cfg.description ?? '');
    this.upsertProp('og:type', cfg.ogType ?? 'website');
    this.upsertProp('og:site_name', SITE);
    this.upsert('twitter:card', 'summary');

    if (cfg.noindex) this.upsert('robots', 'noindex');
    else this.meta.removeTag("name='robots'");

    this.setCanonical(cfg.canonicalPath);
    this.setJsonLd(cfg.jsonLd);
  }

  private upsert(name: string, content: string): void {
    if (content) this.meta.updateTag({ name, content });
    else this.meta.removeTag(`name='${name}'`);
  }

  private upsertProp(property: string, content: string): void {
    if (content) this.meta.updateTag({ property, content });
    else this.meta.removeTag(`property='${property}'`);
  }

  private setCanonical(path?: string): void {
    let link = this.doc.head.querySelector<HTMLLinkElement>("link[rel='canonical']");
    if (!path) {
      link?.remove();
      return;
    }
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', ORIGIN + path);
    this.upsertProp('og:url', ORIGIN + path);
  }

  private setJsonLd(data?: object | object[]): void {
    this.doc.head.querySelectorAll('script[data-seo-jsonld]').forEach(s => s.remove());
    if (!data) return;
    for (const block of Array.isArray(data) ? data : [data]) {
      const script = this.doc.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute('data-seo-jsonld', '');
      script.text = JSON.stringify(block);
      this.doc.head.appendChild(script);
    }
  }
}
