// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { UPSTREAM_ORIGINS } from './upstream/allowlist.js';
import {
  crossOriginPolicies,
  cspDirectives,
  GIS_CONNECT_SOURCE,
  GIS_SCRIPT_SOURCE,
  inlineScriptHashes,
  PERMISSIONS_POLICY,
} from './security.js';

function sha256(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

describe('inlineScriptHashes', () => {
  it('hashes the exact text of each inline script and skips external ones', () => {
    const first = "\n      document.documentElement.dataset.theme = 'dark';\n    ";
    const html = [
      '<!doctype html><html><head>',
      `<script>${first}</script>`,
      '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
      '<SCRIPT type="text/javascript">var a = 1;</SCRIPT >',
      '</head><body></body></html>',
    ].join('\n');
    expect(inlineScriptHashes(html)).toEqual([sha256(first), sha256('var a = 1;')]);
  });

  it('returns nothing for a document without inline scripts', () => {
    expect(inlineScriptHashes('<html><body><script src="/a.js"></script></body></html>')).toEqual([]);
  });
});

describe('cspDirectives', () => {
  it('allows only self for scripts and styles, plus the given hashes and the GIS client script', () => {
    const directives = cspDirectives(["'sha256-abc'"]);
    expect(directives['script-src']).toEqual([
      "'self'",
      "'sha256-abc'",
      'https://accounts.google.com/gsi/client',
    ]);
    expect(directives['style-src']).toEqual(["'self'"]);
    expect(directives['img-src']).toEqual(["'self'", 'data:']);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
  });

  it('lets the SPA reach the backend, the Google OAuth host and the GIS endpoints only', () => {
    // A path that ends with "/" matches only below it: GIS's own endpoints, not the rest of accounts.google.com.
    expect(cspDirectives([])['connect-src']).toEqual([
      "'self'",
      'https://oauth2.googleapis.com',
      'https://accounts.google.com/gsi/',
    ]);
  });

  it('never lets the browser call the APIs the backend calls for it', () => {
    const connect = cspDirectives([])['connect-src'] ?? [];
    for (const origin of UPSTREAM_ORIGINS.filter((upstream) => upstream !== 'https://oauth2.googleapis.com'))
      expect(connect).not.toContain(origin);
  });

  it('opens no frame source: GIS signs in through a window of its own, not a frame', () => {
    const directives = cspDirectives([]);
    expect(directives['frame-src']).toBeUndefined();
    expect(directives['default-src']).toEqual(["'self'"]);
  });

  it('keeps the opener link for windows the page opens (GIS) and nothing more', () => {
    expect(crossOriginPolicies(false)).toEqual({ opener: 'same-origin-allow-popups', embedder: null });
  });

  it('isolates a demo-only page, which opens no window of Google’s', () => {
    expect(crossOriginPolicies(true)).toEqual({ opener: 'same-origin', embedder: 'require-corp' });
  });

  it('never allows unsafe-inline or unsafe-eval', () => {
    const all = Object.values(cspDirectives(["'sha256-abc'"])).flat();
    expect(all.some((source) => source.includes('unsafe'))).toBe(false);
  });

  it('names no Google host but the GIS script, the GIS endpoints and the OAuth host', () => {
    const google = Object.values(cspDirectives([]))
      .flat()
      .filter((source) => source.includes('google'));
    expect(new Set(google)).toEqual(
      new Set([GIS_SCRIPT_SOURCE, GIS_CONNECT_SOURCE, 'https://oauth2.googleapis.com']),
    );
  });
});

describe('PERMISSIONS_POLICY', () => {
  const entries = PERMISSIONS_POLICY.split(', ');

  it('turns off every listed feature except clipboard-write, which only the page itself may use', () => {
    for (const entry of entries) {
      expect(entry, entry).toMatch(/^[a-z-]+=\((?:self)?\)$/);
      if (!entry.startsWith('clipboard-write=')) expect(entry, entry).toMatch(/=\(\)$/);
    }
    expect(entries).toContain('clipboard-write=(self)');
  });

  it('switches off the device, sensor and media features', () => {
    for (const feature of [
      'camera',
      'microphone',
      'geolocation',
      'usb',
      'serial',
      'hid',
      'payment',
      'clipboard-read',
    ])
      expect(entries).toContain(`${feature}=()`);
  });

  it('lists each feature once', () => {
    const names = entries.map((entry) => entry.slice(0, entry.indexOf('=')));
    expect(new Set(names).size).toBe(names.length);
  });
});
