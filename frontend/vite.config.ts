// SPDX-License-Identifier: Apache-2.0
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions, type Rollup, type UserConfig } from 'vite';

/**
 * Vite config for the SPA. `pnpm dev` serves it on :5173 and proxies /api to the backend on :8080.
 * `pnpm dev:demo` (VITE_DEMO=1) serves it on :5174 with no proxy at all: a demo build never calls the
 * backend. Different ports let both run side by side. The e2e suite serves each mode on a free port of its
 * run instead (`--port`, e2e/fixtures/servers.ts); `strictPort` makes a port that is taken fail the start.
 *
 * VITE_STATIC_DEMO=1 builds the static demo (`pnpm demo:static`, scripts/static-demo.mjs, sets it with the
 * rest of the static demo's settings): a demo build, the app in demo-only mode with its configuration built in
 * (src/api/demoConfig.ts), for a static host below `/demo/` (another base with `--base`), written to the repository's
 * `dist/demo/` (another place with `--outDir`), with a copy of index.html per route and the Content Security Policy as a
 * `<meta>` (`staticDemoPages` below, scripts/lib/static-demo.mjs).
 */
export const DEV_PORT = 5173;
export const DEMO_PORT = 5174;
export const BACKEND_URL = 'http://localhost:8080';

const FONT_FILE = /\.(?:woff2?|ttf|otf)$/;

/**
 * The self-hosted font packages whose files the build copies into dist/. Each package's own LICENSE travels with
 * them, unmodified, as dist/licenses/<package>-LICENSE.txt (README.md, "Theme and token policy"); a missing
 * LICENSE fails the build rather than shipping fonts without it.
 */
export const BUNDLED_FONT_PACKAGES = ['@fontsource/roboto', '@fontsource/roboto-mono'] as const;

function fontLicences(): Plugin {
  const resolve = createRequire(import.meta.url).resolve;
  return {
    name: 'gcportrait:font-licences',
    apply: 'build',
    generateBundle() {
      for (const name of BUNDLED_FONT_PACKAGES) {
        this.emitFile({
          type: 'asset',
          fileName: `licenses/${name.slice(name.indexOf('/') + 1)}-LICENSE.txt`,
          source: readFileSync(resolve(`${name}/LICENSE`), 'utf8'),
        });
      }
    },
  };
}

/**
 * gcportrait's own licence (Apache-2.0; its closing note names what it does not cover, the gcportrait name and
 * icon and the third-party material) and its NOTICE, copied byte for byte from the repository root to
 * dist/licenses/gcportrait-<file>.txt, so the built app (and the image that ships it) carries them next to the code
 * it conveys, as the font licences travel with the fonts.
 */
export const OWN_LICENCE_FILES = ['LICENSE', 'NOTICE'] as const;

function ownLicence(): Plugin {
  const root = path.resolve(import.meta.dirname, '..');
  return {
    name: 'gcportrait:own-licence',
    apply: 'build',
    generateBundle() {
      for (const file of OWN_LICENCE_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `licenses/gcportrait-${file}.txt`,
          source: readFileSync(path.join(root, file)),
        });
      }
    },
  };
}

/**
 * The npm packages inlined into the app and its workers, with the backend's production dependencies, go into
 * dist/licenses/THIRD_PARTY_NOTICES.txt (scripts/third-party-notices.mjs): copyright lines, every
 * NOTICE file, the Apache-2.0 text once, the MPL-2.0 sections 3.2 and 3.3 notice, the font licences. Every instance
 * serves it at /licenses/THIRD_PARTY_NOTICES.txt, and the app's Settings page links to it.
 */
export const NOTICES_FILE = 'licenses/THIRD_PARTY_NOTICES.txt';

/** The part of scripts/third-party-notices.mjs the build uses (repository tooling, loaded by its path). */
interface ThirdPartyNotices {
  productionPackageDirs(root: string, projects: readonly string[]): string[];
  renderNotices(input: {
    readonly root: string;
    readonly app: readonly string[];
    readonly server: readonly string[];
  }): string;
}

/** The notices; without the build's package set (the dev server) the app's whole production closure. */
async function thirdPartyNotices(root: string, appPackageDirs?: readonly string[]): Promise<string> {
  const script = pathToFileURL(path.join(root, 'scripts', 'third-party-notices.mjs')).href;
  const notices = (await import(script)) as ThirdPartyNotices;
  return notices.renderNotices({
    root,
    app: appPackageDirs ?? notices.productionPackageDirs(root, ['frontend']),
    server: notices.productionPackageDirs(root, ['backend']),
  });
}

function inlinedPackageLicences(): { app: Plugin; worker: () => Plugin } {
  const packageDirs = new Set<string>();
  const collect = (bundle: Rollup.OutputBundle): void => {
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') continue;
      for (const id of output.moduleIds) {
        const parts = id.replace(/^\0/, '').split('?')[0]?.split('/') ?? [];
        const at = parts.lastIndexOf('node_modules');
        if (at < 0 || at + 1 >= parts.length) continue;
        const scoped = parts[at + 1]?.startsWith('@') === true;
        packageDirs.add(parts.slice(0, at + (scoped ? 3 : 2)).join('/'));
      }
    }
  };
  return {
    // Vite bundles the workers while it transforms the app, so their chunks are known when the app's are written.
    app: {
      name: 'gcportrait:inlined-licences',
      apply: 'build',
      async generateBundle(_options, bundle) {
        collect(bundle);
        this.emitFile({
          type: 'asset',
          fileName: NOTICES_FILE,
          source: await thirdPartyNotices(path.resolve(import.meta.dirname, '..'), [...packageDirs]),
        });
      },
    },
    worker: () => ({
      name: 'gcportrait:inlined-licences-worker',
      apply: 'build',
      generateBundle(_options, bundle) {
        collect(bundle);
      },
    }),
  };
}

/**
 * The licence files the Settings page links (gcportrait's licence, the font licences, the third-party
 * notices) under `pnpm dev` and `pnpm dev:demo` too, where nothing is built: read from the same sources as the
 * build's. With no bundle to inspect, the third-party notices cover the frontend's whole production dependency
 * closure (as `node scripts/third-party-notices.mjs` does), a superset of what a build inlines.
 */
function devLicences(): Plugin {
  const root = path.resolve(import.meta.dirname, '..');
  const resolve = createRequire(import.meta.url).resolve;
  let notices: Promise<string> | undefined;
  const sources = new Map<string, () => Promise<string | Buffer>>([
    ...OWN_LICENCE_FILES.map(
      (file) =>
        [`gcportrait-${file}.txt`, () => Promise.resolve(readFileSync(path.join(root, file)))] as const,
    ),
    ...BUNDLED_FONT_PACKAGES.map(
      (name) =>
        [
          `${name.slice(name.indexOf('/') + 1)}-LICENSE.txt`,
          () => Promise.resolve(readFileSync(resolve(`${name}/LICENSE`))),
        ] as const,
    ),
    [path.basename(NOTICES_FILE), () => (notices ??= thirdPartyNotices(root))],
  ]);
  return {
    name: 'gcportrait:dev-licences',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = /\/licenses\/([\w.-]+)$/.exec((request.url ?? '').split('?')[0] ?? '')?.[1];
        const source = name === undefined ? undefined : sources.get(name);
        if (source === undefined) {
          next();
          return;
        }
        source().then(
          (body) => {
            response.setHeader('content-type', 'text/plain; charset=utf-8');
            response.end(body);
          },
          (error: unknown) => {
            next(error);
          },
        );
      });
    },
  };
}

/**
 * gcportrait's mark as the app's favicon (brand/README.md): brand/icon.svg, the one source of the mark, as it is, written
 * to the build as `favicon.svg` (and served there by the dev server), and linked from index.html under the build's base
 * path. One file for both themes: it carries its dark colours under `prefers-color-scheme: dark`.
 */
export const BRAND_ICON = path.resolve(import.meta.dirname, '..', 'brand', 'icon.svg');

function brandFavicon(): Plugin {
  let base = '/';
  return {
    name: 'gcportrait:brand-favicon',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(`${base}favicon.svg`, (_request, response) => {
        response.setHeader('content-type', 'image/svg+xml');
        response.end(readFileSync(BRAND_ICON));
      });
    },
    transformIndexHtml() {
      return [
        {
          tag: 'link',
          attrs: { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' },
          injectTo: 'head',
        },
      ];
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: readFileSync(BRAND_ICON) });
    },
  };
}

/** The part of scripts/lib/static-demo.mjs the build uses (repository tooling, loaded by its path). */
interface StaticDemoTools {
  readonly DEFAULT_BASE: string;
  readonly STATIC_DEMO_ROUTES: readonly string[];
  withContentSecurityPolicy(html: string): string;
}

async function staticDemoTools(): Promise<StaticDemoTools> {
  const script = pathToFileURL(
    path.resolve(import.meta.dirname, '..', 'scripts', 'lib', 'static-demo.mjs'),
  ).href;
  return (await import(script)) as StaticDemoTools;
}

/**
 * The static demo's pages (VITE_STATIC_DEMO=1; scripts/lib/static-demo.mjs): index.html gets the Content Security Policy
 * as its first `<meta>` after the charset, with the hash of its inline theme bootstrap (after every other change to the
 * page, so the hash is the written script's), and every route of the app a copy of it (`diagram.html`, …), which a
 * static host serves at the route's address, so a reload or a shared link on any route works.
 */
function staticDemoPages(tools: StaticDemoTools): Plugin {
  return {
    name: 'gcportrait:static-demo-pages',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: (html) => tools.withContentSecurityPolicy(html) },
    writeBundle(options) {
      const dir = options.dir;
      if (dir === undefined) throw new Error('static demo: the build has no output directory');
      const index = readFileSync(path.join(dir, 'index.html'));
      for (const route of tools.STATIC_DEMO_ROUTES) writeFileSync(path.join(dir, `${route}.html`), index);
    },
  };
}

/**
 * The two generated data tables the diagram's data worker reads: the compiled asset catalog of
 * `@gcportrait/catalog` (the YAML under packages/catalog compiled to one object, about 600 kB) and the icon table
 * of `@gcportrait/icons` (Google's artwork as SVG strings, about 170 kB). Paths are relative to the repository
 * root; each module exports plain data only (both packages generate them that way).
 */
export const DATA_TABLES = [
  { module: 'packages/catalog/src/generated/compiled-catalog.ts', name: 'catalog-data' },
  { module: 'packages/icons/src/generated/icons.ts', name: 'icon-table' },
] as const;

/**
 * Ships the data tables as JSON files instead of JavaScript (the catalog is data; the icons are
 * images). In the production build of the worker, each table module is evaluated once at build time, its
 * exports are written to `assets/<name>-<hash>.json`, and the module is replaced by one that fetches that file
 * and re-exports the same names (a top-level await, so importers see the same values, already parsed, when
 * they run). The worker loads the tables only when its data role starts, parsing JSON is cheaper than
 * compiling the same object literals as script, and the bytes on the wire are the same either way. A table
 * whose exports do not survive a JSON round trip (a function, `undefined`, a non-finite number) fails the
 * build. The dev server and the tests use the modules as they are.
 */
function dataTablesAsJson(): Plugin {
  const root = path.resolve(import.meta.dirname, '..');
  const tables = new Map<string, string>(
    DATA_TABLES.map((table) => [path.join(root, table.module), table.name]),
  );
  return {
    name: 'gcportrait:data-tables-as-json',
    apply: 'build',
    // After the TypeScript transform: the code is plain JavaScript by then.
    enforce: 'post',
    async transform(code, id) {
      const name = tables.get(id.split('?')[0] ?? id);
      if (name === undefined) return null;
      const evaluated: unknown = await import(
        `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
      );
      const exports: Record<string, unknown> = { ...(evaluated as Record<string, unknown>) };
      const json = JSON.stringify(exports);
      if (!isDeepStrictEqual(JSON.parse(json), exports)) {
        this.error(`${name}: the exports of ${id} are not plain JSON data`);
      }
      const reference = this.emitFile({ type: 'asset', name: `${name}.json`, source: json });
      const lines = [
        `const response = await fetch(import.meta.ROLLUP_FILE_URL_${reference});`,
        `if (!response.ok) throw new Error(\`${name}: HTTP \${String(response.status)}\`);`,
        'const table = await response.json();',
        ...Object.keys(exports).map((key) => `export const ${key} = table[${JSON.stringify(key)}];`),
      ];
      return { code: lines.join('\n'), map: null };
    },
  };
}

/** Where `VITE_STATIC_DEMO=1 vite build` writes the static demo unless `--outDir` says otherwise. */
export const STATIC_DEMO_OUT_DIR = path.resolve(import.meta.dirname, '..', 'dist', 'demo');

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const demo = env.VITE_DEMO === '1';
  const staticDemo = env.VITE_STATIC_DEMO === '1';
  if (demo && staticDemo) {
    throw new Error('VITE_DEMO=1 and VITE_STATIC_DEMO=1 exclude each other: build one or the other.');
  }
  const proxy: Record<string, ProxyOptions> = demo || staticDemo ? {} : { '/api': { target: BACKEND_URL } };
  const licences = inlinedPackageLicences();
  const tools = staticDemo ? await staticDemoTools() : undefined;
  return {
    // The static demo is served below /demo/; every instance at the root of its origin.
    ...(tools === undefined ? {} : { base: tools.DEFAULT_BASE }),
    plugins: [
      react(),
      fontLicences(),
      ownLicence(),
      licences.app,
      devLicences(),
      brandFavicon(),
      ...(tools === undefined ? [] : [staticDemoPages(tools)]),
    ],
    // One dependency cache per mode for ordinary dev servers; e2e's server wrapper supplies its own
    // temporary directory so simultaneous runs never re-optimise into the same cache.
    cacheDir:
      process.env.GCPORTRAIT_VITE_CACHE_DIR ||
      (demo
        ? 'node_modules/.vite-demo'
        : staticDemo
          ? 'node_modules/.vite-static-demo'
          : 'node_modules/.vite'),
    server: { port: demo ? DEMO_PORT : DEV_PORT, strictPort: true, proxy },
    preview: { port: demo ? DEMO_PORT : DEV_PORT, strictPort: true, proxy },
    // The diagram's worker script (src/diagram/pipeline/diagram.worker.ts) loads each role's code with a dynamic
    // import, which needs module workers; its data tables ship as JSON (above).
    worker: { format: 'es', plugins: () => [dataTablesAsJson(), licences.worker()] },
    build: {
      outDir: staticDemo ? STATIC_DEMO_OUT_DIR : 'dist',
      emptyOutDir: true,
      // No source maps in the production bundle: the backend would serve them publicly with the app. The
      // dev server has its own.
      sourcemap: false,
      // Fonts stay separate files: the production CSP allows fonts from 'self' only, not data: URIs.
      assetsInlineLimit: (file) => (FONT_FILE.test(file) ? false : undefined),
    },
  };
});
