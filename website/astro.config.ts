// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, passthroughImageService } from 'astro/config';
import type { AstroIntegration } from 'astro';

import { DEMO_URL, IMPRESSUM_URL, PRIVACY_URL } from './src/site.js';

/**
 * The website: a static Astro site for GitHub Pages at
 * https://gcportrait.app (website/public/CNAME). Every page is a directory with an index.html and a trailing
 * slash, which is what GitHub Pages serves without redirects. No image service: the media are generated
 * (scripts/media.mjs) and used as they are, so sharp (whose libvips is LGPL) is not needed.
 */

const FONT_PACKAGES = ['@fontsource/roboto', '@fontsource/roboto-mono'] as const;

/**
 * The self-hosted Roboto fonts are licensed under the SIL Open Font License 1.1, which requires the copyright notice
 * and the licence to accompany every copy: the build writes each package's own LICENSE, unmodified, to
 * dist/licenses/<name>-LICENSE.txt (as the app does, frontend/vite.config.ts), and gcportrait's own LICENSE
 * (Apache-2.0, with its closing note on the gcportrait name and icon and the third-party material) and NOTICE
 * next to them.
 */
function licenceFiles(): AstroIntegration {
  return {
    name: 'gcportrait:licence-files',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const out = path.join(fileURLToPath(dir), 'licenses');
        mkdirSync(out, { recursive: true });
        const resolve = createRequire(import.meta.url).resolve;
        for (const name of FONT_PACKAGES) {
          copyFileSync(
            resolve(`${name}/LICENSE`),
            path.join(out, `${name.slice(name.indexOf('/') + 1)}-LICENSE.txt`),
          );
        }
        const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        copyFileSync(path.join(repo, 'LICENSE'), path.join(out, 'gcportrait-LICENSE.txt'));
        copyFileSync(path.join(repo, 'NOTICE'), path.join(out, 'gcportrait-NOTICE.txt'));
      },
    },
  };
}

/**
 * The favicon is gcportrait's mark from its one source file, brand/icon.svg at the repository root (brand/README.md),
 * as it is: copied to dist/favicon.svg by the build and served at /favicon.svg by the development server. The logo of
 * the header and the footer draws the same file (src/lib/brand.ts), and `pnpm website:check` compares the two.
 */
function brandFavicon(): AstroIntegration {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'brand', 'icon.svg');
  return {
    name: 'gcportrait:brand-favicon',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'gcportrait:brand-favicon-dev',
                configureServer(server) {
                  server.middlewares.use('/favicon.svg', (_request, response) => {
                    response.setHeader('content-type', 'image/svg+xml');
                    response.end(readFileSync(source));
                  });
                },
              },
            ],
          },
        });
      },
      'astro:build:done': ({ dir }) => {
        copyFileSync(source, path.join(fileURLToPath(dir), 'favicon.svg'));
      },
    },
  };
}

const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The one-line installer at /install.sh (`curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project …`,
 * docs/self-host.md): infra/install.sh from the repository as it is, copied into the build and served by the
 * development server, never a copy kept in public/. `pnpm website:check` compares the built file with the source byte
 * for byte, and robots.txt keeps it out of search results (src/pages/robots.txt.ts); the sitemap lists pages only.
 * GitHub Pages serves it as application/x-sh, which curl does not mind (docs/website.md, "The installer").
 */
function installer(): AstroIntegration {
  const source = path.join(REPOSITORY, 'infra', 'install.sh');
  return {
    name: 'gcportrait:installer',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'gcportrait:installer-dev',
                configureServer(server) {
                  server.middlewares.use('/install.sh', (_request, response) => {
                    response.setHeader('content-type', 'text/plain; charset=utf-8');
                    response.end(readFileSync(source));
                  });
                },
              },
            ],
          },
        });
      },
      'astro:build:done': ({ dir }) => {
        copyFileSync(source, path.join(fileURLToPath(dir), 'install.sh'));
      },
    },
  };
}

/**
 * The demo at /demo/ (src/site.ts DEMO_URL): the static build of the app in demo-only mode, which needs no
 * server, placed into the site after Astro has written its pages. By default the build makes it itself, running the
 * root command (scripts/static-demo.mjs, `pnpm demo:static`) with `--out dist/demo` and the footer's legal links, so
 * `pnpm website:build` alone gives the whole site. With WEBSITE_DEMO_DIST set (a directory, relative to the repository
 * root), it copies that bundle instead, built before for the same base: the deploy workflows build the demo as a step of
 * its own (`pnpm demo:static`, into dist/demo/) and pass WEBSITE_DEMO_DIST=dist/demo. The development server serves
 * the last `pnpm demo:static` bundle (dist/demo/) at /demo/, when there is one: its start page and its files (Astro's
 * trailing-slash rule keeps the app's other routes from a reload there; the built site has them).
 */
function staticDemo(): AstroIntegration {
  const prebuilt = (): string | undefined => {
    const value = process.env.WEBSITE_DEMO_DIST?.trim();
    return value === undefined || value === '' ? undefined : path.resolve(REPOSITORY, value);
  };
  return {
    name: 'gcportrait:static-demo',
    hooks: {
      'astro:server:setup': ({ server }) => {
        const root = prebuilt() ?? path.join(REPOSITORY, 'dist', 'demo');
        const types: Readonly<Record<string, string>> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
          '.txt': 'text/plain; charset=utf-8',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff',
        };
        // A file of the bundle or a folder's index.html, as GitHub Pages serves them, ahead of Astro's page handler
        // (which knows no /demo/ page). Astro's own guards still come first: their trailing-slash rule answers an
        // address without a slash, such as a route of the app (/demo/diagram), with a 404 in development, so a reload
        // there needs the built site (`pnpm --filter @gcportrait/website demo`, scripts/serve.ts).
        const handle = (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
          const pathname = decodeURIComponent((request.url ?? '/').split(/[?#]/)[0] ?? '/');
          if (!pathname.startsWith(DEMO_URL)) {
            next();
            return;
          }
          const file = path.join(root, pathname.slice(DEMO_URL.length));
          const found = [file, path.join(file, 'index.html')].find(
            (candidate) =>
              candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile(),
          );
          if (found === undefined) {
            if (existsSync(path.join(root, 'index.html'))) {
              next();
              return;
            }
            response.statusCode = 404;
            response.setHeader('content-type', 'text/plain; charset=utf-8');
            response.end('No static demo built yet: run `pnpm demo:static`, then reload.\n');
            return;
          }
          response.setHeader('content-type', types[path.extname(found)] ?? 'application/octet-stream');
          response.end(readFileSync(found));
        };
        server.middlewares.stack.unshift({ route: '', handle });
      },
      'astro:build:done': ({ dir, logger }) => {
        const out = path.join(fileURLToPath(dir), DEMO_URL.replace(/^\/|\/$/g, ''));
        rmSync(out, { recursive: true, force: true });
        const source = prebuilt();
        if (source !== undefined) {
          const index = path.join(source, 'index.html');
          if (!existsSync(index)) {
            throw new Error(
              `WEBSITE_DEMO_DIST: no static demo in ${source} (run \`pnpm demo:static\` first)`,
            );
          }
          if (!readFileSync(index, 'utf8').includes(`src="${DEMO_URL}assets/`)) {
            throw new Error(`WEBSITE_DEMO_DIST: the static demo in ${source} was not built for ${DEMO_URL}`);
          }
          cpSync(source, out, { recursive: true });
          logger.info(`the static demo from ${path.relative(REPOSITORY, source)} is at ${DEMO_URL}`);
          return;
        }
        const result = spawnSync(
          process.execPath,
          [
            path.join(REPOSITORY, 'scripts', 'static-demo.mjs'),
            '--out',
            out,
            '--base',
            DEMO_URL,
            '--impressum-url',
            IMPRESSUM_URL,
            '--privacy-url',
            PRIVACY_URL,
          ],
          { cwd: REPOSITORY, stdio: 'inherit' },
        );
        if (result.status !== 0) {
          throw new Error(
            `the static demo did not build (scripts/static-demo.mjs, exit ${String(result.status)})`,
          );
        }
      },
    },
  };
}

/**
 * Every .astro source carries its SPDX header as an HTML comment after the front matter (AGENTS.md, Licence and
 * dependencies), which Astro would copy into every page once per component; the built pages leave them out.
 */
function withoutSourceHeaders(): AstroIntegration {
  const header = /[ \t]*<!-- SPDX-License-Identifier: [^>]* -->\n?/g;
  const htmlFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return htmlFiles(file);
      return entry.name.endsWith('.html') ? [file] : [];
    });
  return {
    name: 'gcportrait:without-source-headers',
    hooks: {
      'astro:build:done': ({ dir }) => {
        for (const file of htmlFiles(fileURLToPath(dir))) {
          const html = readFileSync(file, 'utf8');
          const stripped = html.replace(header, '');
          if (stripped !== html) writeFileSync(file, stripped);
        }
      },
    },
  };
}

export default defineConfig({
  site: 'https://gcportrait.app',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', assets: '_astro' },
  image: { service: passthroughImageService() },
  integrations: [licenceFiles(), brandFavicon(), installer(), withoutSourceHeaders(), staticDemo()],
  devToolbar: { enabled: false },
  compressHTML: false,
  prefetch: false,
  vite: {
    // The site reads docs/ and docs/media/ from the repository root at build time.
    server: { fs: { allow: ['..'] } },
  },
});
