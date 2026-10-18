// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { byteRange, serve, type Served } from './serve.js';

describe('byteRange', () => {
  it('reads the byte ranges a video player asks for', () => {
    expect(byteRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(byteRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    expect(byteRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
  });

  it('serves the whole body for no range or one it cannot serve', () => {
    expect(byteRange(undefined, 100)).toBeUndefined();
    expect(byteRange('bytes=-', 100)).toBeUndefined();
    expect(byteRange('bytes=100-', 100)).toBeUndefined();
    expect(byteRange('bytes=5-2', 100)).toBeUndefined();
    expect(byteRange('bytes=0-1,5-6', 100)).toBeUndefined();
    expect(byteRange('items=0-1', 100)).toBeUndefined();
  });
});

describe('serve', () => {
  let dir = '';
  let site: Served;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'website-serve-'));
    mkdirSync(path.join(dir, 'docs'));
    writeFileSync(path.join(dir, 'index.html'), '<h1>home</h1>');
    writeFileSync(path.join(dir, 'docs', 'index.html'), '<h1>docs</h1>');
    writeFileSync(path.join(dir, '404.html'), '<h1>not found</h1>');
    writeFileSync(path.join(dir, 'demo.webm'), Buffer.from('0123456789'));
    mkdirSync(path.join(dir, 'app'));
    writeFileSync(path.join(dir, 'app', 'index.html'), '<h1>app</h1>');
    writeFileSync(path.join(dir, 'app', 'diagram.html'), '<h1>app at /diagram</h1>');
    site = await serve(dir);
  });

  afterAll(async () => {
    await site.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves a directory’s index.html and 404.html for anything else, as GitHub Pages does', async () => {
    const docs = await fetch(`${site.base}/docs/`);
    expect(docs.status).toBe(200);
    expect(docs.headers.get('content-type')).toContain('text/html');
    expect(await docs.text()).toBe('<h1>docs</h1>');
    const missing = await fetch(`${site.base}/nowhere/`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('text/html');
    expect(await missing.text()).toBe('<h1>not found</h1>');
    expect((await fetch(`${site.base}/../package.json`)).status).toBe(404);
  });

  it('serves x.html for x and redirects a directory to its trailing slash, as GitHub Pages does', async () => {
    const route = await fetch(`${site.base}/app/diagram`);
    expect(route.status).toBe(200);
    expect(await route.text()).toBe('<h1>app at /diagram</h1>');
    const moved = await fetch(`${site.base}/app?x=1`, { redirect: 'manual' });
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe('/app/?x=1');
    expect(await (await fetch(`${site.base}/app`)).text()).toBe('<h1>app</h1>');
    expect((await fetch(`${site.base}/app/diagram/`)).status).toBe(404);
    expect((await fetch(`${site.base}/app/nowhere`)).status).toBe(404);
  });

  it('answers a byte range with 206 and the part asked for', async () => {
    const part = await fetch(`${site.base}/demo.webm`, { headers: { Range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-type')).toBe('video/webm');
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    const whole = await fetch(`${site.base}/demo.webm`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(await whole.text()).toBe('0123456789');
  });
});
