// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';

import { sitemapPaths, sitemapXml } from '../lib/sitemap.js';
import { siteUrl } from '../site.js';

export const GET: APIRoute = () =>
  new Response(sitemapXml(sitemapPaths().map((path) => siteUrl(path))), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
