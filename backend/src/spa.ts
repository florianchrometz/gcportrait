// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { inlineScriptHashes } from './security.js';

/**
 * The built SPA, if there is one. In the production image frontend/dist sits next to the backend and is
 * served from here; in development Vite serves the SPA and this is null.
 */
export type SpaBundle = {
  /** Absolute directory holding index.html and assets/. */
  readonly root: string;
  /** index.html as read at start-up. Served from memory so the CSP hashes always match what is sent. */
  readonly indexHtml: string;
  /** CSP sources for the inline scripts of indexHtml. */
  readonly scriptHashes: readonly string[];
};

/** Loads the SPA bundle from `staticDir`, or returns null when the directory or its index.html is missing. */
export function loadSpaBundle(staticDir: string): SpaBundle | null {
  const indexPath = path.join(staticDir, 'index.html');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) return null;
  const indexHtml = readFileSync(indexPath, 'utf8');
  return { root: staticDir, indexHtml, scriptHashes: inlineScriptHashes(indexHtml) };
}

/** Paths under /api belong to the API and are never answered by static files or the SPA fallback. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Whether an unmatched GET may be answered with index.html: a client-side route such as /diagram, never a
 * missing file (a last segment with an extension such as /assets/app-1234.js) and never the API.
 */
export function isSpaRoute(pathname: string): boolean {
  if (isApiPath(pathname)) return false;
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

/** `cache-control` for Vite's content-hashed build output, whose file name changes whenever its content does. */
export const CACHE_HASHED_ASSET = 'public, max-age=31536000, immutable';

/** `cache-control` for every other file (index.html, favicon, licence texts): revalidate on each load. */
export const CACHE_REVALIDATE = 'no-cache';

/** Whether a file of the SPA bundle is content-hashed build output: Vite writes those, and only those, to assets/. */
export function isHashedAsset(root: string, filePath: string): boolean {
  const [topLevel] = path.relative(root, filePath).split(path.sep);
  return topLevel === 'assets';
}
