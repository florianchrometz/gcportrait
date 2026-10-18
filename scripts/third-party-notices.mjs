// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * The third-party notices of what a gcportrait build conveys (docs/security.md, 11. Licence compliance):
 * one text file, `frontend/dist/licenses/THIRD_PARTY_NOTICES.txt`, served by every instance at
 * `/licenses/THIRD_PARTY_NOTICES.txt` and shipped in the image at `/app/frontend/dist/licenses/`.
 *
 * It lists every third-party npm package in the app's JavaScript (the exact set the frontend build inlined, which
 * frontend/vite.config.ts passes in) and in the backend's image (the backend's production dependencies, a superset
 * of what backend/bundle.ts inlines), with its name, version, licence, home page, copyright lines and where it
 * ships: the app, the server bundle (`backend/dist/server.mjs`), the render worker (`backend/dist/render-worker.mjs`,
 * whose code is the production closure of `packages/render`) or, unmodified, a file of the worker's asset
 * directory (`backend/dist/render-assets/`, {@link RENDER_ASSET_FILES}). It gives what the licences ask to accompany
 * the software:
 *
 * - MIT, ISC, BSD, BlueOak and the like: the package's own licence file, verbatim (it carries the copyright notice
 *   and the permission notice those licences require to be kept);
 * - Apache-2.0 (section 4): the licence's full text once, at the end, and every NOTICE file of an Apache-2.0
 *   package, verbatim (4(d)); a package's licence file is reproduced as well when it holds more than the licence;
 * - MPL-2.0 (sections 3.2 and 3.3): where the Source Code Form of each MPL-covered package is, the notice that it is
 *   used unmodified in a Larger Work (gcportrait, Apache-2.0) and stays under the MPL, its own licence file when
 *   it ships one, and the licence's full text once, at the end (scripts/licenses/MPL-2.0.txt, the canonical text of
 *   https://mozilla.org/MPL/2.0/; `@resvg/resvg-wasm` ships no licence file of its own);
 * - OFL-1.1 (the self-hosted Roboto fonts): the copyright notice and the licence text, verbatim;
 * - any other NOTICE file found in a package, verbatim, whatever its licence.
 *
 * Usage:
 *   node scripts/third-party-notices.mjs                  write the file from the production dependency closure of
 *                                                         frontend/ and backend/ (the build writes it from the exact
 *                                                         app set; this is for a look without a build)
 *   node scripts/third-party-notices.mjs --out FILE       write it elsewhere
 *   node scripts/third-party-notices.mjs --root DIR       another tree (the tests)
 *
 * Plain ESM, Node built-ins only; it reads node_modules, no network. Exit code 0, 1 on a problem, 2 on a usage error.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the frontend build (and this script by default) writes the file, relative to the repository root. */
export const NOTICES_PATH = 'frontend/dist/licenses/THIRD_PARTY_NOTICES.txt';

/** The workspace whose production closure the backend's render worker bundles (backend/bundle.ts). */
export const RENDER_WORKSPACE = 'packages/render';

/**
 * The packages whose files the backend's bundle step copies, unmodified, into the render worker's asset directory
 * (`writeAssetDir` of packages/render/src/assets.ts), with what they ship there and whether their JavaScript is
 * also inlined into the worker. backend/src/render/bundle.test.ts checks this table against the directory the
 * bundle step writes.
 * @type {Readonly<Record<string, { readonly files: string, readonly code: boolean }>>}
 */
export const RENDER_ASSET_FILES = Object.freeze({
  '@resvg/resvg-wasm': { files: 'backend/dist/render-assets/resvg.wasm', code: true },
  '@fontsource/roboto': { files: 'backend/dist/render-assets/fonts/', code: false },
  '@fontsource/roboto-mono': { files: 'backend/dist/render-assets/fonts/', code: false },
});

/** Where a package ships, by key: the short name in the summary and the long one in its section. */
const PLACES = /** @type {const} */ ({
  app: 'the app (frontend/dist/assets)',
  server: 'the server (backend/dist/server.mjs)',
  worker: 'the render worker (backend/dist/render-worker.mjs)',
  assets: "the render worker's assets",
});

/** @typedef {keyof typeof PLACES} Place */

const require = createRequire(import.meta.url);
/** @type {unknown} */
const branding = require(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend/src/branding.ts'),
);
const brandingRecord =
  typeof branding === 'object' && branding !== null ? /** @type {Record<string, unknown>} */ (branding) : {};

/**
 * The non-affiliation statement's long form, exactly as the app words it (frontend/src/branding.ts).
 * @type {string}
 */
export const NON_AFFILIATION_LONG =
  typeof brandingRecord.NON_AFFILIATION_LONG === 'string'
    ? brandingRecord.NON_AFFILIATION_LONG
    : (() => {
        throw new Error('frontend/src/branding.ts exports no NON_AFFILIATION_LONG string.');
      })();

/** Files in a package's root that carry its licence, notices or copyright. */
const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[-._].*)?$/i;
const NOTICE_FILE = /^(?:notice|copyright)(?:[-._].*)?$/i;

/**
 * A line that states a copyright: "Copyright", "copyright" or "©", maybe "(c)", then a year or a capitalised name;
 * or "(c)" and a year at the start. Licence clauses that merely mention copyright ("the above copyright notice",
 * "Grant of Copyright License", "(c) You must retain") are left out.
 */
const COPYRIGHT_LINE =
  /(?:^|[^\w])(?:Copyright|COPYRIGHT|copyright|©)\s*(?:\([cC]\)\s*|©\s*)?(?:\d{4}|[A-Z])|^\s*\([cC]\)\s*\d{4}/;
const NOT_A_HOLDER =
  /copyright (?:notices?|holders?|owners?|licen[cs]es?|laws?|and|statements?|in|to)\b|\[yyyy\]|\{yyyy\}|<year>|\[name of copyright owner\]/i;

const RULE = '='.repeat(100);
const THIN_RULE = '-'.repeat(100);

/**
 * @typedef {{
 *   dir: string,
 *   name: string,
 *   version: string,
 *   license: string,
 *   homepage: string | undefined,
 *   author: string | undefined,
 *   licenseFiles: { file: string, text: string }[],
 *   noticeFiles: { file: string, text: string }[],
 *   copyrights: string[],
 * }} PackageNotice
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {string} dir
 * @returns {Record<string, unknown>}
 */
function readManifest(dir) {
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return isRecord(manifest) ? manifest : {};
}

/**
 * The directory `name` resolves to from `fromDir`, by Node's lookup (each ancestor's node_modules, never a
 * node_modules folder's own), as a real path; undefined when it is not installed.
 * @param {string} fromDir
 * @param {string} name
 * @returns {string | undefined}
 */
function resolvePackageDir(fromDir, name) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    if (path.basename(dir) !== 'node_modules') {
      const candidate = path.join(dir, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate);
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** Whether a real package directory is third-party code (installed under node_modules) rather than a workspace's. */
function isThirdParty(/** @type {string} */ dir) {
  return dir.split(path.sep).includes('node_modules');
}

/**
 * The third-party packages the production code of the given workspace projects may contain: the closure of their
 * `dependencies`, `optionalDependencies` and (where installed) `peerDependencies`, followed through workspace
 * packages, which are gcportrait's own code and are not listed. Optional packages that are not installed (another
 * platform's binaries) are skipped, and so is the closure of each workspace in `skip` (one bundled separately).
 * Real paths, sorted.
 * @param {string} root
 * @param {readonly string[]} projects workspace directories relative to root, such as "backend"
 * @param {readonly string[]} [skip] workspace directories relative to root whose closure is left out
 * @returns {string[]}
 */
export function productionPackageDirs(root, projects, skip = []) {
  /** @type {Set<string>} */
  const seen = new Set(
    skip
      .map((project) => path.join(root, project))
      .filter((dir) => existsSync(dir))
      .map((dir) => realpathSync(dir)),
  );
  /** @type {Set<string>} */
  const thirdParty = new Set();
  const queue = projects.map((project) => realpathSync(path.join(root, project)));
  while (queue.length > 0) {
    const dir = queue.pop();
    if (dir === undefined || seen.has(dir)) continue;
    seen.add(dir);
    if (isThirdParty(dir)) thirdParty.add(dir);
    const manifest = readManifest(dir);
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const deps = manifest[field];
      if (!isRecord(deps)) continue;
      for (const name of Object.keys(deps)) {
        const found = resolvePackageDir(dir, name);
        if (found !== undefined) queue.push(found);
      }
    }
  }
  return [...thirdParty].sort();
}

/**
 * The text files of a package's root directory whose names match `pattern`, verbatim.
 * @param {string} dir
 * @param {RegExp} pattern
 * @returns {{ file: string, text: string }[]}
 */
function rootFiles(dir, pattern) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((file) => ({ file, text: readFileSync(path.join(dir, file), 'utf8').replace(/\s+$/, '') }));
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function personOf(value) {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.name === 'string') return value.name;
  return undefined;
}

/**
 * @param {Record<string, unknown>} manifest
 * @returns {string}
 */
function licenseOf(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (isRecord(manifest.license) && typeof manifest.license.type === 'string') return manifest.license.type;
  if (Array.isArray(manifest.licenses)) {
    const types = manifest.licenses
      .map((entry) => (isRecord(entry) && typeof entry.type === 'string' ? entry.type : undefined))
      .filter((type) => type !== undefined);
    if (types.length > 0) return types.join(' OR ');
  }
  return 'unknown';
}

/**
 * @param {Record<string, unknown>} manifest
 * @returns {string | undefined}
 */
function homepageOf(manifest) {
  if (typeof manifest.homepage === 'string') return manifest.homepage;
  const repository = manifest.repository;
  const url = typeof repository === 'string' ? repository : isRecord(repository) ? repository.url : undefined;
  return typeof url === 'string' ? url.replace(/^git\+/, '').replace(/\.git$/, '') : undefined;
}

/**
 * The copyright lines of a package's licence and notice files, in order, each once.
 * @param {readonly { text: string }[]} files
 * @returns {string[]}
 */
export function copyrightLines(files) {
  /** @type {string[]} */
  const lines = [];
  for (const { text } of files) {
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!COPYRIGHT_LINE.test(trimmed) || NOT_A_HOLDER.test(trimmed)) continue;
      if (!lines.includes(trimmed)) lines.push(trimmed);
    }
  }
  return lines;
}

/**
 * What the notices say about one package.
 * @param {string} dir
 * @returns {PackageNotice}
 */
export function describePackage(dir) {
  const manifest = readManifest(dir);
  const licenseFiles = rootFiles(dir, LICENSE_FILE);
  const noticeFiles = rootFiles(dir, NOTICE_FILE);
  return {
    dir,
    name: typeof manifest.name === 'string' ? manifest.name : path.basename(dir),
    version: typeof manifest.version === 'string' ? manifest.version : 'unknown',
    license: licenseOf(manifest),
    homepage: homepageOf(manifest),
    author: personOf(manifest.author),
    licenseFiles,
    noticeFiles,
    copyrights: copyrightLines([...licenseFiles, ...noticeFiles]),
  };
}

/**
 * @param {string} license
 * @param {string} id
 * @returns {boolean}
 */
function names(license, id) {
  return new RegExp(`(?:^|[\\s(])${id.replace(/[.+]/g, '\\$&')}(?:$|[\\s)])`).test(license);
}

/**
 * The part of an Apache-2.0 licence file after the licence itself (after its appendix's boilerplate, or after "END
 * OF TERMS AND CONDITIONS" without one): extra terms a package added, which travel with it too.
 * @param {string} text
 * @returns {string}
 */
export function apacheExtra(text) {
  if (!/Apache License/i.test(text) || !/Version 2\.0, January 2004/i.test(text)) return text;
  const appendixEnd = text.lastIndexOf('limitations under the License.');
  const termsEnd = text.indexOf('END OF TERMS AND CONDITIONS');
  const cut =
    appendixEnd >= 0
      ? appendixEnd + 'limitations under the License.'.length
      : termsEnd >= 0
        ? termsEnd + 'END OF TERMS AND CONDITIONS'.length
        : text.length;
  return text.slice(cut).trim();
}

/**
 * @param {PackageNotice} pkg
 * @returns {string}
 */
function sourceOf(pkg) {
  const tarball = `https://registry.npmjs.org/${pkg.name}/-/${pkg.name.replace(/^@[^/]+\//, '')}-${pkg.version}.tgz`;
  return pkg.homepage === undefined ? tarball : `${tarball} (project: ${pkg.homepage})`;
}

/** The canonical MPL-2.0 text's address, named next to every MPL-covered package. */
const MPL_URL = 'https://mozilla.org/MPL/2.0/';

/**
 * @param {PackageNotice} pkg
 * @param {readonly string[]} where
 * @returns {string}
 */
function packageSection(pkg, where) {
  const apache = names(pkg.license, 'Apache-2.0');
  const mpl = names(pkg.license, 'MPL-2.0');
  const lines = [
    RULE,
    `${pkg.name}@${pkg.version}`,
    RULE,
    `Licence: ${pkg.license}`,
    `In: ${where.join(', ')}`,
    ...(pkg.homepage === undefined ? [] : [`Home page: ${pkg.homepage}`]),
    '',
    'Copyright:',
    ...(pkg.copyrights.length > 0
      ? pkg.copyrights.map((line) => `  ${line}`)
      : [
          `  (no copyright line in the package's files${pkg.author === undefined ? '' : `; its package.json names the author: ${pkg.author}`})`,
        ]),
  ];
  if (mpl) {
    lines.push(
      '',
      'MPL-2.0 (sections 3.2 and 3.3): this package is Covered Software under the Mozilla Public License 2.0. It is',
      'used unmodified as part of a Larger Work, gcportrait (Apache-2.0), and stays under the MPL-2.0; its',
      `Source Code Form is available at ${sourceOf(pkg)}.`,
      `The Mozilla Public License 2.0 is at the end of this file (and at ${MPL_URL}).`,
    );
  }
  for (const { file, text } of pkg.noticeFiles) {
    lines.push('', `${file} (verbatim):`, THIN_RULE, text, THIN_RULE);
  }
  for (const { file, text } of pkg.licenseFiles) {
    if (apache) {
      const extra = apacheExtra(text);
      lines.push(
        '',
        `${file}: the Apache License 2.0, whose full text is at the end of this file.` +
          (extra === '' ? '' : ' The file goes on with these further terms (verbatim):'),
      );
      if (extra !== '') lines.push(THIN_RULE, extra, THIN_RULE);
    } else {
      lines.push('', `${file} (verbatim):`, THIN_RULE, text, THIN_RULE);
    }
  }
  if (pkg.licenseFiles.length === 0) {
    lines.push(
      '',
      `The package ships no licence file; its package.json declares ${pkg.license}.` +
        (apache ? ' The Apache License 2.0 is at the end of this file.' : ''),
    );
  }
  return lines.join('\n');
}

/**
 * A licence text of scripts/licenses/, without its trailing white space.
 * @param {string} root
 * @param {string} id
 * @returns {string}
 */
function licenceText(root, id) {
  return readFileSync(path.join(root, 'scripts', 'licenses', `${id}.txt`), 'utf8').replace(/\s+$/, '');
}

/**
 * The notices file for the packages in the app and in the backend's image. `server` is the backend's production
 * closure; a package in the closure of {@link RENDER_WORKSPACE} is the render worker's (and the server's only when
 * the backend reaches it without that workspace too), and a package of {@link RENDER_ASSET_FILES} (or the
 * `assetFiles` given) also names the asset files it ships as.
 * @param {{
 *   root: string,
 *   app: readonly string[],
 *   server: readonly string[],
 *   assetFiles?: Readonly<Record<string, { readonly files: string, readonly code: boolean }>>,
 * }} input package directories
 * @returns {string}
 */
export function renderNotices({ root, app, server, assetFiles = RENDER_ASSET_FILES }) {
  /** @type {Map<string, Set<Place>>} */
  const where = new Map();
  /** @type {Map<string, string>} */
  const shippedAs = new Map();
  const add = (/** @type {string} */ dir, /** @type {Place} */ place) => {
    const places = where.get(dir) ?? new Set();
    places.add(place);
    where.set(dir, places);
  };
  for (const dir of app) add(realpathSync(dir), 'app');
  const renderManifest = path.join(root, RENDER_WORKSPACE, 'package.json');
  const worker = new Set(existsSync(renderManifest) ? productionPackageDirs(root, [RENDER_WORKSPACE]) : []);
  const serverOnly = new Set(productionPackageDirs(root, ['backend'], [RENDER_WORKSPACE]));
  for (const dir of server) {
    const real = realpathSync(dir);
    if (!worker.has(real) || serverOnly.has(real)) add(real, 'server');
    if (!worker.has(real)) continue;
    const asset = assetFiles[describePackage(real).name];
    if (asset === undefined || asset.code) add(real, 'worker');
    if (asset !== undefined) {
      add(real, 'assets');
      shippedAs.set(real, asset.files);
    }
  }
  const placesOf = (/** @type {string} */ dir) => [...(where.get(dir) ?? [])];
  const longPlaces = (/** @type {string} */ dir) =>
    placesOf(dir).map((place) =>
      place === 'assets'
        ? `${PLACES.assets} (${shippedAs.get(dir) ?? 'backend/dist/render-assets/'})`
        : PLACES[place],
    );
  const packages = [...where.keys()]
    .map(describePackage)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
  const apacheText = licenceText(root, 'Apache-2.0');
  const anyApache = packages.some((pkg) => names(pkg.license, 'Apache-2.0'));
  const mplPackages = packages.filter((pkg) => names(pkg.license, 'MPL-2.0'));
  const mplText = mplPackages.length > 0 ? licenceText(root, 'MPL-2.0') : '';
  const width = Math.max(...packages.map((pkg) => `${pkg.name}@${pkg.version}`.length), 10);
  const summary = packages.map((pkg) => {
    const labels = placesOf(pkg.dir).join(', ');
    return `  ${`${pkg.name}@${pkg.version}`.padEnd(width)}  ${pkg.license.padEnd(14)}  ${labels}`;
  });
  return `${[
    'gcportrait: third-party notices',
    RULE,
    '',
    NON_AFFILIATION_LONG,
    '',
    "gcportrait's own work is licensed under the Apache License 2.0, except the gcportrait name and icon, which identify the",
    'project (licenses/gcportrait-LICENSE.txt next to this file). This file lists the third-party software this',
    "build conveys, in the app's JavaScript, in the server and in its render worker, with the notices its licences",
    'ask to accompany it. None of it is covered by the Apache License 2.0 of gcportrait; each package keeps its own',
    "licence. The Google Cloud product icons in the app are Google's trademarks, used under Google's icon usage",
    'terms (a trademark permission, not a software licence); THIRD_PARTY.md in the source tree describes them.',
    '',
    '- Apache License 2.0 (section 4): its full text is reproduced once, at the end of this file; the NOTICE file of',
    '  every Apache-2.0 package that has one is reproduced verbatim in its section.' +
      (anyApache ? '' : ' (No Apache-2.0 package is part of this build.)'),
    '- Mozilla Public License 2.0 (sections 3.2 and 3.3): each MPL-covered package says where its Source Code Form',
    "  is; it is used unmodified in a Larger Work and stays under the MPL-2.0. The licence's full text is reproduced",
    `  once, at the end of this file (and is at ${MPL_URL}).` +
      (mplPackages.length > 0 ? '' : ' (No MPL-2.0 package is part of this build.)'),
    '- SIL Open Font License 1.1 (the Roboto fonts): the copyright notice and the licence text, verbatim.',
    "- Every other licence: the package's own licence file, verbatim, with its copyright notice.",
    '',
    `Generated by scripts/third-party-notices.mjs. ${String(packages.length)} packages, each with where it ships`,
    "(app; server; worker, the render worker's code; assets, files of the render worker's asset directory):",
    '',
    ...summary,
  ].join('\n')}\n\n${packages.map((pkg) => packageSection(pkg, longPlaces(pkg.dir))).join('\n\n')}\n\n${[
    ...(mplPackages.length > 0
      ? [RULE, 'Mozilla Public License, Version 2.0 (full text)', RULE, '', mplText, '', '']
      : []),
    RULE,
    'Apache License, Version 2.0 (full text)',
    RULE,
    '',
    apacheText,
  ].join('\n')}\n`;
}

/**
 * Writes the notices for the given app packages (default: the frontend's production closure) and the backend's
 * production closure.
 * @param {{ root: string, out: string, app?: readonly string[] }} options
 * @returns {number} the number of packages
 */
export function writeNotices({ root, out, app }) {
  const appDirs = app ?? productionPackageDirs(root, ['frontend']);
  const serverDirs = productionPackageDirs(root, ['backend']);
  const text = renderNotices({ root, app: appDirs, server: serverDirs });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, text);
  return new Set([...appDirs, ...serverDirs].map((dir) => realpathSync(dir))).size;
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
export function run(argv) {
  /** @type {{ root: string, out: string }} */
  let options;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { root: { type: 'string' }, out: { type: 'string' } },
      strict: true,
    });
    const root = realpathSync(path.resolve(values.root ?? DEFAULT_ROOT));
    options = { root, out: path.resolve(values.out ?? path.join(root, NOTICES_PATH)) };
  } catch (error) {
    console.error(`third-party-notices: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (!existsSync(path.join(options.root, 'node_modules'))) {
    console.error('third-party-notices: node_modules is missing; run `pnpm install` first.');
    return 1;
  }
  const count = writeNotices(options);
  console.log(
    `third-party-notices: ${String(count)} packages written to ${path.relative(process.cwd(), options.out)}.`,
  );
  return 0;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
