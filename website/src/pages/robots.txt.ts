// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';

import { siteUrl } from '../site.js';

/**
 * Every page may be crawled; the sitemap lists them. The installer (/install.sh, a shell script for `curl … | bash`,
 * astro.config.ts) is not a page and stays out of search results.
 */
export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\nDisallow: /install.sh\n\nSitemap: ${siteUrl('/sitemap.xml')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
