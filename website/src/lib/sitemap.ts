// SPDX-License-Identifier: Apache-2.0
/**
 * The pages the sitemap lists: every page of the site except the 404 page, in menu order, and the demo's entry page
 * (/demo/, src/site.ts DEMO_URL; the static demo the build places there), but none of the demo's other routes
 * (/demo/diagram and the like are states of the same app). The site checker (scripts/check-site.ts) compares
 * it with the pages the build wrote. The Impressum and the privacy notice are not pages of this site (src/site.ts,
 * LEGAL_LINKS).
 */
import { DEMO_URL } from '../site.js';
import { renderedDocs } from './docs.js';

export function sitemapPaths(): string[] {
  return [
    '/',
    DEMO_URL,
    '/docs/',
    ...renderedDocs().map((doc) => doc.path),
    '/exports/',
    '/coverage/',
    '/contributing/',
    '/licence/',
  ];
}

export function sitemapXml(urls: readonly string[]): string {
  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escape(url)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}
