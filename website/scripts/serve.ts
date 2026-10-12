// SPDX-License-Identifier: MIT
/**
 * Serves a built site (website/dist) on a free port of 127.0.0.1 the way GitHub Pages serves it: a directory's
 * index.html (a directory's address without its trailing slash is redirected to it, 301), `x.html` for the address `x`
 * (the static demo's route copies: /demo/diagram is demo/diagram.html), the site's 404.html with status 404 for anything
 * else (only the top-level one: GitHub Pages never uses a 404.html in a folder), and byte ranges (`Range: bytes=…`,
 * status 206), which Safari's video player asks for before it plays a WebM. Used by `pnpm website:lighthouse`,
 * `pnpm --filter @gcportrait/website mobile` and `… demo`, so a running `astro preview` (Astro allows only one) is never
 * in the way.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

/**
 * The content type of a file by its extension, as GitHub Pages sends it (its list is the mime-db one): `.sh`, the
 * installer, is application/x-sh there, which `pnpm website:check` accepts for it (scripts/check-site.ts).
 */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.sh': 'application/x-sh',
};

export type Served = { readonly server: Server; readonly base: string; readonly close: () => Promise<void> };

/** The part of `body` a `Range` header asks for, or undefined for the whole body (or a range it cannot serve). */
export function byteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (match === null || (match[1] === '' && match[2] === '')) return undefined;
  const [, from = '', to = ''] = match;
  const start = from === '' ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return start <= end && start < size ? { start, end } : undefined;
}

export function serve(dist: string): Promise<Served> {
  const root = path.resolve(dist);
  const server = createServer((request, response) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      pathname = '/404.html';
    }
    let file = path.join(root, pathname);
    if (!file.startsWith(root)) file = path.join(root, '404.html');
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!pathname.endsWith('/')) {
        const search = new URL(request.url ?? '/', 'http://localhost').search;
        response.writeHead(301, { Location: `${encodeURI(pathname)}/${search}`, 'Content-Length': '0' });
        response.end();
        return;
      }
      file = path.join(file, 'index.html');
    } else if (!existsSync(file) && !pathname.endsWith('/') && existsSync(`${file}.html`)) {
      file = `${file}.html`;
    }
    const found = existsSync(file) && statSync(file).isFile();
    const body = readFileSync(found ? file : path.join(root, '404.html'));
    const headers = {
      'Content-Type': CONTENT_TYPES[path.extname(found ? file : '404.html')] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    };
    const range = found ? byteRange(request.headers.range, body.length) : undefined;
    if (range !== undefined) {
      response.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${String(range.start)}-${String(range.end)}/${String(body.length)}`,
        'Content-Length': String(range.end - range.start + 1),
      });
      response.end(body.subarray(range.start, range.end + 1));
      return;
    }
    response.writeHead(found ? 200 : 404, { ...headers, 'Content-Length': String(body.length) });
    response.end(body);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        server,
        base: `http://127.0.0.1:${String(port)}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}
