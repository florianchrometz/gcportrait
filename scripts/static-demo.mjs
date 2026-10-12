// SPDX-License-Identifier: MIT
// @ts-check
/**
 * `pnpm demo:static`: builds the static demo (ADR 0034), the app in demo-only mode as a self-contained bundle for a
 * static host, which the website serves at https://gcportrait.app/demo/ on GitHub Pages. It needs no server: no
 * backend, no rewrites, no headers. What it holds and why (scripts/lib/static-demo.mjs, docs/website.md "The demo"):
 *
 * - the app (frontend/, `vite build` with VITE_STATIC_DEMO=1) below the base path `/demo/`, assets content-hashed, the
 *   theme bootstrap kept, the brand icon as its favicon, the licence files in `licenses/`;
 * - its configuration built in, a demo-only instance's (frontend/src/api/staticConfig.ts): no sign-in and nothing
 *   read from Google Cloud, the version (`git describe`), the source link (VITE_SOURCE_URL, or the repository), and the
 *   Impressum and the privacy notice the footer links (the maintainer's pages unless --impressum-url and --privacy-url
 *   name others); no Google sign-in code at all;
 * - a copy of index.html per route (`diagram.html`, `snapshots.html`, …), so a reload or a shared link on any route
 *   works on a host without rewrites;
 * - the backend's demo-only Content Security Policy as a `<meta>` (without `frame-ancestors`, which a `<meta>` cannot
 *   carry), with the inline bootstrap's hash.
 *
 *   node scripts/static-demo.mjs [--out DIR]          the bundle in DIR (default: dist/demo/ at the repository root)
 *                                [--base PATH]        the path it is served at (default /demo/; starts and ends with /)
 *                                [--impressum-url URL] [--privacy-url URL]   the linked legal pages (https)
 *                                [--app-version V]    the version it reports (default: `git describe`)
 *
 * The website's build (website/astro.config.ts) runs this with `--out website/dist/demo` and the website's legal
 * links, or copies a bundle built before when WEBSITE_DEMO_DIST names it (the deploy workflows build it as a step of
 * its own first). After the build the bundle is checked (scripts/lib/static-demo.mjs, `staticDemoProblems`): a
 * problem fails the command. Exit code 0 on success, 1 on a failure, 2 on a usage error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { DEFAULT_BASE, STATIC_DEMO_ROUTES, staticDemoProblems } from './lib/static-demo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');

/** Where the bundle goes unless --out says otherwise: the root's dist/ (git-ignored, like every build output). */
export const DEFAULT_OUT = path.join(ROOT, 'dist', 'demo');

/**
 * The maintainer's Impressum and privacy notice, which the maintainer's demo links (decision of 2026-10-11, ADR 0032 as
 * amended). The website's footer links the same pages (IMPRESSUM_URL and PRIVACY_URL in website/src/site.ts);
 * scripts/static-demo.test.ts fails while the two differ. Someone who publishes a static demo of their own links their
 * own pages with --impressum-url and --privacy-url.
 */
export const MAINTAINER_IMPRESSUM_URL = 'https://florian-chrometz.de/legal/impressum';
export const MAINTAINER_PRIVACY_URL = 'https://florian-chrometz.de/legal/privacy-policy';

export class UsageError extends Error {}

/**
 * A path as the log shows it: relative to the working directory when it is below it.
 * @param {string} file
 */
function shown(file) {
  const relative = path.relative(process.cwd(), file);
  return relative === '' ? '.' : relative.startsWith('..') ? file : relative;
}

/** @param {string} message */
function log(message) {
  process.stdout.write(`demo:static: ${message}\n`);
}

/**
 * An https URL as the backend accepts a linked legal page: a host, no user name or password.
 * @param {string} value
 */
export function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/**
 * The version the bundle reports: `git describe --tags --always --dirty` (a release tag without its leading "v", as
 * the image reports it), or the root package's version outside a git checkout.
 * @param {string} [root]
 * @returns {string}
 */
export function describeVersion(root = ROOT) {
  try {
    const described = execFileSync('git', ['describe', '--tags', '--always', '--dirty'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (described !== '') return described.replace(/^v(?=\d)/, '');
  } catch {
    // Not a git checkout (a source archive): the package's version below.
  }
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version =
    typeof manifest === 'object' && manifest !== null && 'version' in manifest ? manifest.version : undefined;
  return typeof version === 'string' ? version : 'unknown';
}

/**
 * @typedef {{
 *   out: string, base: string, impressumUrl: string, privacyUrl: string, version: string | undefined,
 * }} Options
 */

/**
 * The command's options, checked.
 * @param {readonly string[]} argv
 * @param {string} [cwd]
 * @returns {Options & { help: boolean }}
 */
export function parseOptions(argv, cwd = process.cwd()) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      out: { type: 'string' },
      base: { type: 'string', default: DEFAULT_BASE },
      'impressum-url': { type: 'string', default: MAINTAINER_IMPRESSUM_URL },
      'privacy-url': { type: 'string', default: MAINTAINER_PRIVACY_URL },
      'app-version': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  const base = values.base;
  if (!/^\/(?:(?!\.\.?\/)[\w.~-]+\/)*$/.test(base))
    throw new UsageError(`--base ${base}: a path that starts and ends with "/", such as /demo/`);
  for (const [name, value] of /** @type {const} */ ([
    ['--impressum-url', values['impressum-url']],
    ['--privacy-url', values['privacy-url']],
  ])) {
    if (!isHttpsUrl(value))
      throw new UsageError(`${name} ${value}: an https URL without a user name or password`);
  }
  const version = values['app-version']?.trim();
  if (version === '') throw new UsageError('--app-version: not empty');
  return {
    help: values.help,
    out: values.out === undefined ? DEFAULT_OUT : path.resolve(cwd, values.out),
    base,
    impressumUrl: values['impressum-url'],
    privacyUrl: values['privacy-url'],
    version,
  };
}

/**
 * The build's environment: the static demo's VITE_ variables (frontend/src/api/staticConfig.ts) on top of `env`.
 * VITE_SOURCE_URL is left as `env` has it (the repository by default).
 * @param {Options} options
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function buildEnvironment(options, env) {
  if (env.VITE_DEMO === '1')
    throw new UsageError('VITE_DEMO=1 is set: the static demo is a build of its own');
  return {
    ...env,
    VITE_STATIC_DEMO: '1',
    VITE_APP_VERSION: options.version ?? describeVersion(),
    VITE_LEGAL_IMPRESSUM_URL: options.impressumUrl,
    VITE_LEGAL_PRIVACY_URL: options.privacyUrl,
  };
}

/** @param {readonly string[]} argv */
export async function main(argv) {
  const options = parseOptions(argv);
  if (options.help) {
    process.stdout.write(
      'usage: node scripts/static-demo.mjs [--out DIR] [--base /demo/] [--impressum-url URL] [--privacy-url URL] [--app-version V]\n',
    );
    return 0;
  }
  const env = buildEnvironment(options, process.env);
  // Vite reads the VITE_ variables from the process's environment (import.meta.env, frontend/vite.config.ts).
  for (const [name, value] of Object.entries(env)) if (name.startsWith('VITE_')) process.env[name] = value;
  const started = Date.now();
  const { build } = await import('vite');
  await build({
    root: FRONTEND,
    configFile: path.join(FRONTEND, 'vite.config.ts'),
    base: options.base,
    logLevel: 'warn',
    build: { outDir: options.out, emptyOutDir: true },
  });
  const problems = staticDemoProblems(options.out, options.base);
  if (problems.length > 0) {
    process.stderr.write(`demo:static: the bundle in ${options.out} is not right:\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    return 1;
  }
  log(
    `built ${shown(options.out)} for ${options.base} in ${String(Math.round((Date.now() - started) / 1000))} s: ` +
      `version ${env.VITE_APP_VERSION ?? ''}, Impressum ${options.impressumUrl}, privacy notice ${options.privacyUrl}, ` +
      `index.html and a copy for ${STATIC_DEMO_ROUTES.map((route) => `/${route}`).join(', ')}, the policy <meta> checked.`,
  );
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (/** @type {unknown} */ error) => {
      if (
        error instanceof UsageError ||
        (error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'))
      ) {
        process.stderr.write(`demo:static: ${error.message}\n`);
        process.exitCode = 2;
      } else {
        process.stderr.write(
          `demo:static: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    },
  );
}
