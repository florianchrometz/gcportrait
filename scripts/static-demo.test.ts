// SPDX-License-Identifier: MIT
/**
 * The static demo's tooling (ADR 0034): scripts/lib/static-demo.mjs and scripts/static-demo.mjs. The policy is the
 * backend's demo-only one without what a `<meta>` cannot carry, the route copies are App.tsx's routes, the website's
 * check and footer agree with both, and the bundle check finds what it must.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_BASE,
  inlineScriptHashes,
  META_UNSUPPORTED_DIRECTIVES,
  parsePolicy,
  policyMetas,
  policyText,
  STATIC_DEMO_ROUTES,
  staticDemoDirectives,
  staticDemoProblems,
  withContentSecurityPolicy,
} from './lib/static-demo.mjs';
import {
  buildEnvironment,
  DEFAULT_OUT,
  describeVersion,
  MAINTAINER_IMPRESSUM_URL,
  MAINTAINER_PRIVACY_URL,
  parseOptions,
} from './static-demo.mjs';
import { REPO as ROOT, createTempTree, type TempTree } from './testing/temp-tree.js';

type Directives = Readonly<Record<string, readonly string[]>>;

/** Another workspace's module, loaded by its path (repository tooling may read them; no package imports this). */
async function load<T>(file: string): Promise<T> {
  return (await import(pathToFileURL(path.join(ROOT, file)).href)) as T;
}

const scratch: TempTree[] = [];
afterEach(() => {
  for (const tree of scratch.splice(0)) tree.remove();
});

/** A throw-away directory, removed after the test. */
function scratchTree(prefix: string): TempTree {
  const tree = createTempTree(prefix);
  scratch.push(tree);
  return tree;
}

describe('the static demo’s Content Security Policy', () => {
  it('is the backend’s demo-only policy without the directives a <meta> cannot carry', async () => {
    const security = await load<{
      cspDirectives: (sources: readonly string[], options: { google: boolean }) => Directives;
      inlineScriptHashes: (html: string) => string[];
    }>('backend/src/security.ts');
    const html = readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');
    const hashes = inlineScriptHashes(html);
    expect(hashes).toEqual(security.inlineScriptHashes(html));
    expect(hashes).toHaveLength(1);
    const backend = Object.fromEntries(
      Object.entries(security.cspDirectives(hashes, { google: false })).filter(
        ([name]) => !META_UNSUPPORTED_DIRECTIVES.includes(name),
      ),
    );
    expect(staticDemoDirectives(hashes)).toEqual(backend);
    expect(Object.keys(security.cspDirectives(hashes, { google: false }))).toContain('frame-ancestors');
    // No host at all: 'self', 'none', data: and the hashes only.
    for (const values of Object.values(staticDemoDirectives(hashes)))
      for (const value of values) expect(value).toMatch(/^(?:'self'|'none'|data:|'sha256-[A-Za-z0-9+/=]+')$/);
  });

  it('goes first after the charset, with the hash of the page’s own inline script', () => {
    const html =
      '<!doctype html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n    <title>x</title>\n    <script>var a = 1;</script>\n    <script type="module" src="/demo/assets/x.js"></script>\n  </head>\n</html>\n';
    const out = withContentSecurityPolicy(html);
    expect(out).toContain(
      '<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src \'self\';',
    );
    expect(out).toContain('\'" />\n    <meta name="referrer" content="no-referrer" />\n    <title>');
    expect(policyMetas(out)).toHaveLength(1);
    const policy = parsePolicy(policyMetas(out)[0] ?? '');
    expect(policy['script-src']).toEqual(["'self'", ...inlineScriptHashes(html)]);
    expect(policyText(policy)).toBe(policyText(staticDemoDirectives(inlineScriptHashes(html))));
    expect(() => withContentSecurityPolicy(out)).toThrow(/already has/);
    expect(withContentSecurityPolicy('<html><head><title>x</title></head></html>')).toMatch(
      /^<html><head>\n<meta http-equiv="Content-Security-Policy"[^>]*>\n<meta name="referrer" content="no-referrer" \/><title>/,
    );
  });

  it('agrees with the website’s check, which runs on the demo it links', async () => {
    const check = await load<{ DEMO_POLICY: Directives; DEMO_ROUTES: readonly string[] }>(
      'website/scripts/check-site.ts',
    );
    expect({ ...check.DEMO_POLICY, 'script-src': ["'self'", 'HASH'] }).toEqual(
      staticDemoDirectives(['HASH']),
    );
    expect(check.DEMO_ROUTES).toEqual(STATIC_DEMO_ROUTES);
  });
});

describe('the route copies', () => {
  it('are the app’s routes (frontend/src/App.tsx) besides its start page and the catch-all', () => {
    const app = readFileSync(path.join(ROOT, 'frontend', 'src', 'App.tsx'), 'utf8');
    const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)]
      .map((match) => match[1] ?? '')
      .filter((route) => route !== '*');
    expect(routes).toEqual([...STATIC_DEMO_ROUTES]);
  });
});

describe('the command', () => {
  it('builds for the address the website links the demo at, linking the maintainer’s pages its footer links too', async () => {
    const pages = await load<{ IMPRESSUM_URL: string; PRIVACY_URL: string; DEMO_URL: string }>(
      'website/src/site.ts',
    );
    expect(MAINTAINER_IMPRESSUM_URL).toBe(pages.IMPRESSUM_URL);
    expect(MAINTAINER_PRIVACY_URL).toBe(pages.PRIVACY_URL);
    expect(DEFAULT_BASE).toBe(pages.DEMO_URL);
  });

  it('builds for /demo/ into dist/demo by default, and takes another output, base, legal pages and version', () => {
    const options = parseOptions([]);
    expect(options).toEqual({
      help: false,
      out: DEFAULT_OUT,
      base: '/demo/',
      impressumUrl: MAINTAINER_IMPRESSUM_URL,
      privacyUrl: MAINTAINER_PRIVACY_URL,
      version: undefined,
    });
    expect(DEFAULT_OUT).toBe(path.join(ROOT, 'dist', 'demo'));
    expect(
      parseOptions(
        [
          '--out',
          'site/demo',
          '--base',
          '/try/',
          '--impressum-url',
          'https://operator.example.com/i',
          '--privacy-url',
          'https://operator.example.com/p',
          '--app-version',
          '2.0.0',
        ],
        '/work',
      ),
    ).toEqual({
      help: false,
      out: path.resolve('/work', 'site/demo'),
      base: '/try/',
      impressumUrl: 'https://operator.example.com/i',
      privacyUrl: 'https://operator.example.com/p',
      version: '2.0.0',
    });
  });

  it('refuses a base without its slashes, a legal page that is not https, an empty version', () => {
    for (const args of [
      ['--base', 'demo'],
      ['--base', '/demo'],
      ['--base', '/../'],
      ['--impressum-url', 'http://operator.example.com/i'],
      ['--privacy-url', 'https://user:pw@operator.example.com/p'],
      ['--app-version', ' '],
    ]) {
      expect(() => parseOptions(args)).toThrow();
    }
  });

  it('sets the static demo’s variables, and refuses the build-time demo mode next to them', () => {
    const options = { ...parseOptions(['--app-version', '1.2.3']), help: undefined };
    expect(buildEnvironment(options, { PATH: '/bin', VITE_SOURCE_URL: 'https://git.example.org/x' })).toEqual(
      {
        PATH: '/bin',
        VITE_SOURCE_URL: 'https://git.example.org/x',
        VITE_STATIC_DEMO: '1',
        VITE_APP_VERSION: '1.2.3',
        VITE_LEGAL_IMPRESSUM_URL: MAINTAINER_IMPRESSUM_URL,
        VITE_LEGAL_PRIVACY_URL: MAINTAINER_PRIVACY_URL,
      },
    );
    expect(() => buildEnvironment(options, { VITE_DEMO: '1' })).toThrow(/VITE_DEMO/);
  });

  it('reports `git describe` without a release tag’s "v", or the package’s version outside git', () => {
    expect(describeVersion()).toMatch(/^(?!v\d)\S+$/);
    const outside = scratchTree('static-demo-version');
    outside.write('package.json', JSON.stringify({ version: '9.8.7' }));
    expect(describeVersion(outside.root)).toBe('9.8.7');
  });
});

/** A small built bundle as the build writes it, with `change` applied to its index.html first. */
function bundle(change: (html: string) => string = (html) => html): string {
  const tree = scratchTree('static-demo-bundle');
  tree.write('assets/index-1.js', 'console.log("app")');
  tree.write('assets/index-1.css', 'body{}');
  tree.write('favicon.svg', '<svg/>');
  const html = change(
    withContentSecurityPolicy(
      '<html><head>\n<meta charset="UTF-8" />\n<script>var a = 1;</script>\n<script type="module" crossorigin src="/demo/assets/index-1.js"></script>\n<link rel="stylesheet" href="/demo/assets/index-1.css">\n<link rel="icon" href="/demo/favicon.svg" type="image/svg+xml">\n</head><body></body></html>\n',
    ),
  );
  tree.write('index.html', html);
  for (const route of STATIC_DEMO_ROUTES) tree.write(`${route}.html`, html);
  return tree.root;
}

describe('staticDemoProblems (the check after the build)', () => {
  it('accepts a bundle as the build writes it', () => {
    expect(staticDemoProblems(bundle())).toEqual([]);
  });

  it('finds a missing or changed route copy, a wrong policy, a load outside the base, a sign-in host', () => {
    const dir = bundle();
    rmSync(path.join(dir, 'settings.html'));
    writeFileSync(path.join(dir, 'diagram.html'), 'other');
    writeFileSync(path.join(dir, 'assets', 'gis.js'), 'load("https://accounts.google.com/gsi/client")');
    expect(staticDemoProblems(dir)).toEqual([
      'diagram.html is not a copy of index.html',
      "settings.html is missing (the settings route's copy of index.html)",
      'assets/gis.js names accounts.google.com',
    ]);
    expect(
      staticDemoProblems(
        bundle((html) => html.replace("connect-src 'self'", "connect-src 'self' https://x.example.com")),
      ),
    ).toEqual([expect.stringMatching(/^index\.html's policy is /)]);
    expect(
      staticDemoProblems(bundle((html) => html.replace('/demo/assets/index-1.css', '/assets/index-1.css'))),
    ).toEqual(['index.html loads /assets/index-1.css, which is not under /demo/']);
    expect(staticDemoProblems(bundle((html) => html.replace('/demo/favicon.svg', '/demo/icon.svg')))).toEqual(
      [
        'index.html loads /demo/icon.svg, which the build does not have',
        'index.html does not link /demo/favicon.svg',
      ],
    );
    expect(staticDemoProblems(path.join(tmpdir(), 'no-such-static-demo'))).toEqual([
      `${path.join(tmpdir(), 'no-such-static-demo')}: no index.html`,
    ]);
  });
});
