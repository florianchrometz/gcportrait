// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CACHE_HASHED_ASSET,
  CACHE_REVALIDATE,
  contentTypeFor,
  isApiPath,
  isSpaRoute,
  loadSpaBundle,
  pathnameOf,
  registerSpa,
  sendAsset,
} from './spa.js';

describe('contentTypeFor', () => {
  it('maps known file extensions to expected MIME types', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('app.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('module.mjs')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('styles.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('data.json')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('icon.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('photo.png')).toBe('image/png');
    expect(contentTypeFor('image.webp')).toBe('image/webp');
    expect(contentTypeFor('favicon.ico')).toBe('image/x-icon');
    expect(contentTypeFor('font.woff2')).toBe('font/woff2');
    expect(contentTypeFor('font.woff')).toBe('font/woff');
    expect(contentTypeFor('font.ttf')).toBe('font/ttf');
    expect(contentTypeFor('font.otf')).toBe('font/otf');
    expect(contentTypeFor('license.txt')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor('manifest.webmanifest')).toBe('application/manifest+json');
  });

  it('falls back to application/octet-stream for unknown extensions', () => {
    expect(contentTypeFor('file.unknown')).toBe('application/octet-stream');
    expect(contentTypeFor('file-without-extension')).toBe('application/octet-stream');
  });
});

describe('isApiPath', () => {
  it('identifies paths belonging to the API', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api/')).toBe(true);
    expect(isApiPath('/api/config')).toBe(true);
    expect(isApiPath('/api/assets/stream')).toBe(true);
  });

  it('does not match non-API paths', () => {
    expect(isApiPath('/')).toBe(false);
    expect(isApiPath('/diagram')).toBe(false);
    expect(isApiPath('/api-doc')).toBe(false);
    expect(isApiPath('/assets/index.js')).toBe(false);
  });
});

describe('isSpaRoute', () => {
  it('returns true for routes without file extension', () => {
    expect(isSpaRoute('/')).toBe(true);
    expect(isSpaRoute('/diagram')).toBe(true);
    expect(isSpaRoute('/settings')).toBe(true);
    expect(isSpaRoute('/snapshots')).toBe(true);
  });

  it('returns false for files with extension and API routes', () => {
    expect(isSpaRoute('/assets/main.js')).toBe(false);
    expect(isSpaRoute('/favicon.ico')).toBe(false);
    expect(isSpaRoute('/api/config')).toBe(false);
  });
});

describe('pathnameOf', () => {
  it('strips query parameters from request url', async () => {
    const app = Fastify();
    let parsedPath = '';
    app.get('/*', (request) => {
      parsedPath = pathnameOf(request);
      return 'ok';
    });
    await app.inject({ method: 'GET', url: '/diagram?filter=vpc&zoom=2' });
    expect(parsedPath).toBe('/diagram');
  });
});

describe('loadSpaBundle', () => {
  let scratch = '';

  beforeAll(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'gcportrait-spa-test-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('returns null when static directory or index.html is missing', () => {
    expect(loadSpaBundle(path.join(scratch, 'non-existent'))).toBeNull();
    const noIndex = path.join(scratch, 'no-index');
    mkdirSync(noIndex, { recursive: true });
    expect(loadSpaBundle(noIndex)).toBeNull();
  });

  it('loads static assets into memory, skipping dotfiles and api folders', () => {
    const dist = path.join(scratch, 'dist');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    mkdirSync(path.join(dist, '.hidden'), { recursive: true });
    mkdirSync(path.join(dist, 'api'), { recursive: true });

    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><body>SPA</body></html>');
    writeFileSync(path.join(dist, 'favicon.svg'), '<svg></svg>');
    writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log("hi");');
    writeFileSync(path.join(dist, '.env'), 'SECRET=forbidden');
    writeFileSync(path.join(dist, '.hidden', 'secret.txt'), 'secret');
    writeFileSync(path.join(dist, 'api', 'shadow.txt'), 'shadow');

    const bundle = loadSpaBundle(dist);
    expect(bundle).not.toBeNull();
    if (bundle === null) return;

    expect(bundle.assets.has('/')).toBe(true);
    expect(bundle.assets.has('/index.html')).toBe(true);
    expect(bundle.assets.has('/favicon.svg')).toBe(true);
    expect(bundle.assets.has('/assets/index-abc.js')).toBe(true);

    // Dotfiles, dot directories, and api paths are never loaded
    expect(bundle.assets.has('/.env')).toBe(false);
    expect(bundle.assets.has('/.hidden/secret.txt')).toBe(false);
    expect(bundle.assets.has('/api/shadow.txt')).toBe(false);

    // Cache control rules
    expect(bundle.assets.get('/assets/index-abc.js')?.cacheControl).toBe(CACHE_HASHED_ASSET);
    expect(bundle.assets.get('/favicon.svg')?.cacheControl).toBe(CACHE_REVALIDATE);
    expect(bundle.assets.get('/')?.cacheControl).toBe(CACHE_REVALIDATE);

    // ETags
    const asset = bundle.assets.get('/assets/index-abc.js');
    expect(asset?.etag).toMatch(/^"[0-9a-f]{64}"$/);
  });
});

describe('sendAsset and registerSpa', () => {
  let dist = '';

  beforeAll(() => {
    dist = mkdtempSync(path.join(tmpdir(), 'gcportrait-serve-spa-test-'));
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><body>Home</body></html>');
    writeFileSync(path.join(dist, 'assets', 'bundle-123.js'), 'export const a = 1;');
  });

  afterAll(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  it('serves assets and handles 304 If-None-Match revalidation', async () => {
    const bundle = loadSpaBundle(dist);
    expect(bundle).not.toBeNull();
    if (bundle === null) return;

    const app = Fastify();
    registerSpa(app, bundle);

    const assetRes = await app.inject({ method: 'GET', url: '/assets/bundle-123.js' });
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.headers['content-type']).toBe('text/javascript; charset=utf-8');
    const etag = String(assetRes.headers['etag']);
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

    // 304 response with matching ETag
    const revalRes = await app.inject({
      method: 'GET',
      url: '/assets/bundle-123.js',
      headers: { 'if-none-match': etag },
    });
    expect(revalRes.statusCode).toBe(304);
    expect(revalRes.body).toBe('');

    // 304 response with weak ETag format W/"..."
    const weakRes = await app.inject({
      method: 'GET',
      url: '/assets/bundle-123.js',
      headers: { 'if-none-match': `W/${etag}` },
    });
    expect(weakRes.statusCode).toBe(304);

    // 200 response when ETag does not match
    const mismatchedRes = await app.inject({
      method: 'GET',
      url: '/assets/bundle-123.js',
      headers: { 'if-none-match': '"different"' },
    });
    expect(mismatchedRes.statusCode).toBe(200);
  });

  it('handles HEAD requests for static assets with correct content-length and no body', async () => {
    const bundle = loadSpaBundle(dist);
    expect(bundle).not.toBeNull();
    if (bundle === null) return;

    const app = Fastify();
    registerSpa(app, bundle);

    const headRes = await app.inject({ method: 'HEAD', url: '/assets/bundle-123.js' });
    expect(headRes.statusCode).toBe(200);
    expect(headRes.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(Number(headRes.headers['content-length'])).toBe('export const a = 1;'.length);
  });

  it('sends an asset directly via sendAsset', async () => {
    const app = Fastify();
    const asset = {
      body: Buffer.from('hello test'),
      contentType: 'text/plain; charset=utf-8',
      etag: '"test-etag"',
      cacheControl: CACHE_REVALIDATE,
    };
    app.get('/custom', (request, reply) => {
      sendAsset(request, reply, asset);
    });
    const res = await app.inject({ method: 'GET', url: '/custom' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('hello test');
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['etag']).toBe('"test-etag"');
  });
});
