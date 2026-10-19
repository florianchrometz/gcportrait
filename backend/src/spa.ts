// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { inlineScriptHashes } from './security.js';

/**
 * An in-memory static file from the SPA build, ready to serve with headers.
 */
export type SpaAsset = {
  readonly body: Buffer;
  readonly contentType: string;
  readonly etag: string;
  readonly cacheControl: string;
};

/**
 * The built SPA, if there is one. In the production image frontend/dist sits next to the backend and is
 * served from memory; in development Vite serves the SPA and this is null.
 */
export type SpaBundle = {
  /** Absolute directory holding index.html and assets/. */
  readonly root: string;
  /** index.html as read at start-up. */
  readonly indexAsset: SpaAsset;
  /** The raw index.html text. */
  readonly indexHtml: string;
  /** CSP sources for the inline scripts of indexHtml. */
  readonly scriptHashes: readonly string[];
  /** In-memory static assets keyed by normalised request path (leading slash, posix separators). */
  readonly assets: ReadonlyMap<string, SpaAsset>;
};

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

/** Content type for a static file based on its extension. */
export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
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

/** Paths under /api belong to the API and are never answered by static files or the SPA fallback. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** Extracts the pathname (excluding query string) from a request. */
export function pathnameOf(request: FastifyRequest): string {
  const queryStart = request.url.indexOf('?');
  return queryStart < 0 ? request.url : request.url.slice(0, queryStart);
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

/**
 * Loads the SPA bundle from `staticDir` recursively into memory, or returns null when the
 * directory or its index.html is missing. Dotfiles and dot-directories are skipped.
 */
export function loadSpaBundle(staticDir: string): SpaBundle | null {
  const indexPath = path.join(staticDir, 'index.html');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) return null;

  const assets = new Map<string, SpaAsset>();

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPosix = path.relative(staticDir, fullPath).split(path.sep).join('/');
        const reqPath = `/${relPosix}`;
        // Static files never answer for the API, even if the build output had an api/ folder.
        if (isApiPath(reqPath)) continue;
        const body = readFileSync(fullPath);
        const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
        const contentType = contentTypeFor(fullPath);
        const cacheControl = isHashedAsset(staticDir, fullPath) ? CACHE_HASHED_ASSET : CACHE_REVALIDATE;
        assets.set(reqPath, { body, contentType, etag, cacheControl });
      }
    }
  }

  walk(staticDir);

  const indexAsset = assets.get('/index.html');
  if (indexAsset === undefined) return null;
  assets.set('/', indexAsset);

  const indexHtml = indexAsset.body.toString('utf8');
  return {
    root: staticDir,
    indexAsset,
    indexHtml,
    scriptHashes: inlineScriptHashes(indexHtml),
    assets,
  };
}

/** Matches If-None-Match header value against an ETag (supporting weak/strong tokens and wildcard). */
function matchesIfNoneMatch(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  const trimmed = ifNoneMatch.trim();
  if (trimmed === '*') return true;
  for (const token of trimmed.split(',')) {
    const candidate = token.trim();
    if (
      candidate === etag ||
      candidate === `W/${etag}` ||
      candidate.replace(/^W\//, '') === etag.replace(/^W\//, '')
    ) {
      return true;
    }
  }
  return false;
}

/** Sends a SpaAsset with content-type, cache-control, etag, and 304 handling. */
export function sendAsset(request: FastifyRequest, reply: FastifyReply, asset: SpaAsset): void {
  reply.header('content-type', asset.contentType);
  reply.header('cache-control', asset.cacheControl);
  reply.header('etag', asset.etag);

  if (matchesIfNoneMatch(request.headers['if-none-match'], asset.etag)) {
    reply.code(304).send();
    return;
  }

  reply.code(200).send(asset.body);
}

/**
 * Registers the in-memory SPA route handler for GET and HEAD requests.
 * Matched assets are served directly from memory; API paths and unmatched requests
 * fall through to the not-found handler via reply.callNotFound().
 */
export function registerSpa(app: FastifyInstance, spa: SpaBundle): void {
  app.route({
    method: ['GET', 'HEAD'],
    url: '/*',
    handler: async (request, reply) => {
      const pathname = pathnameOf(request);
      if (isApiPath(pathname)) {
        reply.callNotFound();
        return;
      }
      const asset = spa.assets.get(pathname);
      if (asset !== undefined) {
        sendAsset(request, reply, asset);
        return;
      }
      reply.callNotFound();
    },
  });
}
