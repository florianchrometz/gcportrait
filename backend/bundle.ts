// SPDX-License-Identifier: MIT
/**
 * Bundles the backend into ESM files for the production image (infra/Dockerfile): `pnpm --filter
 * @gcportrait/backend bundle` writes
 *
 *   dist/server.mjs                         the service, with every npm dependency and workspace package inlined
 *   dist/server.mjs.map                     its source map (no sources inside; Node maps stack traces with it
 *                                           when started with --enable-source-maps)
 *   dist/render-worker.mjs (and .map)       the render API's worker (ADR 0033): the render library, the frontend's
 *                                           SVG components, react-dom/server and resvg-wasm's glue code; started
 *                                           afresh for every render by src/render/runner.ts, never imported by
 *                                           server.mjs
 *   dist/render-assets/                     what the worker reads at run time: resvg's WebAssembly module and the
 *                                           Roboto faces in their loading order, with their licences and a
 *                                           manifest (written by @gcportrait/render's writeAssetDir)
 *   dist/licenses/server-dependencies.txt   name, version, declared licence, the files it ships in and licence
 *                                           text of every npm package inlined into either bundle or copied into
 *                                           dist/render-assets/
 *
 * `--outdir DIR` writes the same into DIR instead (src/render/bundle.test.ts).
 *
 * Why a bundle: the workspace packages (`@gcportrait/model`, ...) export their TypeScript sources, and Node
 * cannot run those from an image (type stripping refuses files under node_modules and does not map the `.js`
 * specifiers of NodeNext sources to `.ts`). Bundling resolves them at build time, so the image needs no
 * node_modules, no pnpm and no compiler: a smaller image with fewer files to patch, and a faster cold start on
 * Cloud Run. The alternative, compiling every workspace package to JavaScript and rewriting their `exports`,
 * would change every package's build for the sake of one consumer. esbuild compiles each file with its nearest
 * tsconfig, so the frontend's components get the frontend's JSX settings. A native addon (`.node`) cannot be
 * bundled, and the image has no node_modules to load one from: the step fails on any.
 *
 * Licences: a bundle drops the LICENSE files that node_modules would have carried, while MIT, BSD, ISC and
 * Apache-2.0 ask for their notices to travel with every copy. The esbuild metafiles name each file that went
 * into the bundles, so the script writes the licence of every package they came from next to them, and of the
 * packages whose files dist/render-assets/ holds (resvg-wasm, MPL-2.0; the fonts, OFL-1.1, ADR 0019), with the
 * files each one ships in. An MPL-2.0 package also gets where its Source Code Form is and the section 3.3
 * statement, and the file ends with the canonical MPL-2.0 text (scripts/licenses/MPL-2.0.txt): resvg-wasm ships
 * no licence file of its own.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseArgs } from 'node:util';

import { RESVG_WASM_PACKAGE, assetPackageDirs, writeAssetDir } from '@gcportrait/render';
import { build, type Metafile } from 'esbuild';

const BACKEND_ROOT = import.meta.dirname;
/** The canonical MPL-2.0 text, which the licence file carries once for the MPL-2.0 packages. */
const MPL_TEXT_FILE = path.join(BACKEND_ROOT, '..', 'scripts', 'licenses', 'MPL-2.0.txt');
const MPL_URL = 'https://mozilla.org/MPL/2.0/';
const { values } = parseArgs({ options: { outdir: { type: 'string' } }, strict: true });
const OUT_DIR = values.outdir === undefined ? path.join(BACKEND_ROOT, 'dist') : path.resolve(values.outdir);
const OUT_FILE = path.join(OUT_DIR, 'server.mjs');
const WORKER_FILE = path.join(OUT_DIR, 'render-worker.mjs');
const ASSET_DIR = path.join(OUT_DIR, 'render-assets');
const LICENCE_FILE = path.join(OUT_DIR, 'licenses', 'server-dependencies.txt');

/**
 * Dependencies written as CommonJS call `require()` for Node's built-in modules, which an ESM bundle does not
 * define; this banner gives the bundle a real `require`, scoped to its own file.
 */
const REQUIRE_SHIM = [
  "import { createRequire as __gcportraitCreateRequire } from 'node:module';",
  'const require = __gcportraitCreateRequire(import.meta.url);',
].join('\n');

const LICENCE_FILE_NAME = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

type PackageInfo = { name: string; version: string; licence: string; dir: string };

/** Which files of the output each package ships in, by package directory. */
type ShippedIn = ReadonlyMap<string, readonly string[]>;

/** The package directory an input path belongs to: everything up to its last node_modules/<name>. */
function packageDirOf(input: string): string | null {
  const parts = input.split('/');
  const at = parts.lastIndexOf('node_modules');
  if (at < 0 || at + 1 >= parts.length) return null;
  const nameParts = parts[at + 1]?.startsWith('@') === true ? 2 : 1;
  return path.resolve(BACKEND_ROOT, parts.slice(0, at + 1 + nameParts).join('/'));
}

function readManifest(dir: string): PackageInfo {
  const manifest: unknown = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const field = (key: string): string => {
    if (typeof manifest !== 'object' || manifest === null || !(key in manifest)) return 'unknown';
    const value: unknown = (manifest as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : 'unknown';
  };
  return { name: field('name'), version: field('version'), licence: field('license'), dir };
}

/** The package directories whose files went into a bundle. Workspace packages are our own code. */
function bundledDirs(metafile: Metafile): Set<string> {
  const dirs = new Set<string>();
  for (const input of Object.keys(metafile.inputs)) {
    const dir = packageDirOf(input);
    if (dir !== null) dirs.add(dir);
  }
  return dirs;
}

/** The npm packages in `dirs`, sorted by name. */
function packagesIn(dirs: ReadonlySet<string>): PackageInfo[] {
  return [...dirs]
    .map(readManifest)
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function licenceText(dir: string): string {
  const files = readdirSync(dir).filter((file) => LICENCE_FILE_NAME.test(file));
  if (files.length === 0)
    return '(The package ships no licence file; its package.json declares the licence above.)';
  return files.map((file) => readFileSync(path.join(dir, file), 'utf8').trimEnd()).join('\n\n');
}

const isMpl = (pkg: PackageInfo): boolean => /(?:^|[\s(])MPL-2\.0(?:$|[\s)])/.test(pkg.licence);

/** MPL-2.0 sections 3.2 and 3.3: where the Covered Software's source is, and that it stays under the MPL. */
function mplStatement(pkg: PackageInfo): string {
  const tarball = `https://registry.npmjs.org/${pkg.name}/-/${pkg.name.replace(/^@[^/]+\//, '')}-${pkg.version}.tgz`;
  return [
    'MPL-2.0 (sections 3.2 and 3.3): this package is Covered Software under the Mozilla Public License 2.0. It is',
    'used unmodified as part of a Larger Work, gcportrait (MIT), and stays under the MPL-2.0; its Source',
    `Code Form is available at ${tarball}.`,
    `The licence's full text is at the end of this file (and at ${MPL_URL}).`,
  ].join('\n');
}

function licenceReport(packages: readonly PackageInfo[], shippedIn: ShippedIn): string {
  const where = (pkg: PackageInfo): string => (shippedIn.get(pkg.dir) ?? []).join(', ');
  const mpl = packages.some(isMpl);
  const header = [
    'Third-party software inlined into server.mjs and render-worker.mjs, the gcportrait backend bundles, or copied',
    'unmodified into render-assets/ next to them (resvg-wasm, MPL-2.0: its Source Code Form is the npm package of',
    'that version, used unmodified in a Larger Work; the Roboto fonts, OFL-1.1). Each line names the files the',
    'package ships in.',
    'Each package keeps its own licence; none of it is covered by the MIT License of gcportrait itself',
    '(frontend/dist/licenses/gcportrait-LICENSE.txt).',
    ...(mpl ? ["The Mozilla Public License 2.0's full text is at the end of this file."] : []),
    '',
    ...packages.map((pkg) => `- ${pkg.name}@${pkg.version} (${pkg.licence}): ${where(pkg)}`),
  ].join('\n');
  const sections = packages.map((pkg) =>
    [
      `${'='.repeat(78)}\n${pkg.name}@${pkg.version} (${pkg.licence})\n${'='.repeat(78)}`,
      `In: ${where(pkg)}`,
      ...(isMpl(pkg) ? [mplStatement(pkg)] : []),
      licenceText(pkg.dir),
    ].join('\n\n'),
  );
  const mplText = mpl
    ? [
        `${'='.repeat(78)}\nMozilla Public License, Version 2.0 (full text)\n${'='.repeat(78)}\n\n` +
          readFileSync(MPL_TEXT_FILE, 'utf8').trimEnd(),
      ]
    : [];
  return `${[header, ...sections, ...mplText].join('\n\n')}\n`;
}

/** Fails on a native addon, which neither bundle can carry (ADR 0033 §9). */
function refuseNativeAddons(metafile: Metafile, what: string): void {
  const native = Object.keys(metafile.inputs).filter((input) => input.endsWith('.node'));
  if (native.length > 0) throw new Error(`bundle: ${what} would need native addons: ${native.join(', ')}`);
}

const common = {
  absWorkingDir: BACKEND_ROOT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  sourcesContent: false,
  metafile: true,
  legalComments: 'none',
  banner: { js: REQUIRE_SHIM },
  logLevel: 'warning',
} as const;

const server = await build({
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: OUT_FILE,
  // The render worker and its assets, next to server.mjs (src/render/runner.ts).
  define: {
    __GCPORTRAIT_RENDER_WORKER__: JSON.stringify(`./${path.basename(WORKER_FILE)}`),
    __GCPORTRAIT_RENDER_ASSETS__: JSON.stringify(`./${path.basename(ASSET_DIR)}/`),
  },
});
refuseNativeAddons(server.metafile, 'server.mjs');

const worker = await build({
  ...common,
  entryPoints: ['src/render/worker.ts'],
  outfile: WORKER_FILE,
  // React's production build, as the image runs with NODE_ENV=production anyway.
  define: { 'process.env.NODE_ENV': '"production"' },
});
refuseNativeAddons(worker.metafile, 'render-worker.mjs');

const assets = writeAssetDir(ASSET_DIR);
const copiedDirs = assetPackageDirs();

// Where each package ships: the bundles its files went into, and what dist/render-assets/ holds of it.
const shippedIn = new Map<string, string[]>();
const ships = (dir: string, file: string): void => {
  const files = shippedIn.get(dir) ?? [];
  if (!files.includes(file)) files.push(file);
  shippedIn.set(dir, files);
};
for (const dir of bundledDirs(server.metafile)) ships(dir, path.basename(OUT_FILE));
for (const dir of bundledDirs(worker.metafile)) ships(dir, path.basename(WORKER_FILE));
const fontDir = `${path.posix.dirname(assets.fonts[0] ?? 'fonts/none')}/`;
for (const dir of copiedDirs)
  ships(
    dir,
    `${path.basename(ASSET_DIR)}/${readManifest(dir).name === RESVG_WASM_PACKAGE ? assets.wasm : fontDir}`,
  );

const packages = packagesIn(new Set(shippedIn.keys()));
mkdirSync(path.dirname(LICENCE_FILE), { recursive: true });
writeFileSync(LICENCE_FILE, licenceReport(packages, shippedIn));

const bytesOf = (result: { metafile: Metafile }, file: string): number =>
  result.metafile.outputs[path.relative(BACKEND_ROOT, file)]?.bytes ?? 0;
for (const [result, file] of [
  [server, OUT_FILE],
  [worker, WORKER_FILE],
] as const) {
  if (!existsSync(file) || bytesOf(result, file) === 0)
    throw new Error(`bundle: ${path.basename(file)} was not written`);
}
process.stdout.write(
  `bundle: ${path.relative(BACKEND_ROOT, OUT_FILE)} ${(bytesOf(server, OUT_FILE) / 1024).toFixed(0)} kB, ` +
    `${path.relative(BACKEND_ROOT, WORKER_FILE)} ${(bytesOf(worker, WORKER_FILE) / 1024).toFixed(0)} kB, ` +
    `${path.relative(BACKEND_ROOT, ASSET_DIR)}/ (${String(assets.fonts.length)} fonts), ` +
    `${String(packages.length)} npm packages (licences in ${path.relative(BACKEND_ROOT, LICENCE_FILE)})\n`,
);
