// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Licence guard for npm dependencies (AGENTS.md, Licence and dependencies; Security and privacy,
 * principle 7).
 *
 *   node scripts/check-licenses.mjs               verify (CI and `pnpm check`)
 *   node scripts/check-licenses.mjs --write       regenerate the dependency section of THIRD_PARTY.md
 *   node scripts/check-licenses.mjs --list-rules  print the allowlist, the exceptions and the deny list
 *   node scripts/check-licenses.mjs --root <dir>  check another tree (used by the tests)
 *
 * gcportrait's own code is MIT (the "license" field of the root package.json), and whoever receives it may rely on
 * the MIT License alone. A dependency may therefore only carry a licence that does not force gcportrait to publish
 * its code or to relicense its combined work under other terms: an MIT project cannot carry copyleft code whose
 * reach goes beyond the dependency's own files (MPL-2.0, file-scoped, is the one weak copyleft allowed). Exit code 0
 * when clean, 1 on a licence or staleness problem, 2 on a usage error. Verify mode fails when
 *   - any installed package (the full tree, direct and transitive, production and dev) declares a licence
 *     expression that cannot be satisfied from ALLOWED_LICENSES (or, for a package named in
 *     PACKAGE_LICENSE_EXCEPTIONS, is not exactly the licence named there); an expression that names a family of
 *     DENIED_LICENSE_FAMILIES (or is custom, proprietary, unknown or absent) fails with the family's reason, or
 *   - the generated section of THIRD_PARTY.md differs from what --write would produce (stale file).
 *   - a workspace project's package.json declares a `license` other than the root package.json's (every workspace
 *     package is gcportrait's own code, under the one project licence), or none, or
 * An expression with an allowed alternative ("MIT OR GPL-3.0-only") passes: gcportrait uses it under MIT.
 * A tree without a single third-party package (pnpm then prints "No licenses in packages found" instead of JSON) is
 * checked like any other: nothing to allow or deny.
 *
 * The installed tree comes from `pnpm licenses list --json` and the workspace projects from
 * `pnpm ls -r --depth -1 --json`; both read the local install, no network. Run `pnpm install` first.
 * Invoke it as `pnpm run licenses` (plain `pnpm licenses` is pnpm's own built-in command).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { readProjectLicenseId } from './lib/repo-files.mjs';
import { isLicenseAllowed, licenseIdsOf } from './lib/spdx-expression.mjs';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN_MARKER = '<!-- BEGIN GENERATED: npm-dependencies (scripts/check-licenses.mjs --write) -->';
const END_MARKER = '<!-- END GENERATED: npm-dependencies -->';

/** What a denied licence is told, whatever its family. */
const DENIED_MESSAGE = "would impose obligations on gcportrait's combined work or is unverifiable";

/**
 * Licences a dependency may be used under. All are permissive except MPL-2.0, which is allowed because its
 * copyleft is file-scoped: it binds only the MPL-licensed files themselves, which we consume unmodified from
 * node_modules (for example the accessibility engine used by the e2e tests), and its section 3.3 lets them be part
 * of a Larger Work under other terms, such as gcportrait's MIT License. MIT-0 is MIT without the attribution clause,
 * strictly more permissive than MIT; jsdom's CSS colour stack uses it.
 */
const ALLOWED_LICENSES = Object.freeze([
  'MIT',
  'MIT-0',
  'ISC',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',
  'MPL-2.0',
]);

/**
 * Licences accepted for named packages only, each with the reason it is acceptable there. A listed package
 * is accepted under exactly the licence named here (or anything on ALLOWED_LICENSES); keep the list short.
 *
 * SIL OFL 1.1, fonts only (AGENTS.md, Licence and dependencies): the app self-hosts its Roboto fonts (the
 * production CSP and the offline demo rule out a font CDN). The font files are bundled unmodified into
 * frontend/dist and so are redistributed with the production image. OFL 1.1 permits that (the fonts may not
 * be sold on their own) provided the copyright notice and the licence accompany every copy; the frontend
 * build writes each package's own LICENSE file to dist/licenses/ (frontend/vite.config.ts). OFL 1.1 does not
 * extend to the software that uses the fonts, so it places no obligation on gcportrait's own licence. The
 * website self-hosts the same two packages and writes their LICENSE files to website/dist/licenses/
 * (website/astro.config.ts).
 * @type {Readonly<Record<string, { license: string, reason: string }>>}
 */
const PACKAGE_LICENSE_EXCEPTIONS = Object.freeze({
  '@fontsource/roboto': {
    license: 'OFL-1.1',
    reason: 'self-hosted UI font; its licence ships in frontend/dist/licenses/',
  },
  '@fontsource/roboto-mono': {
    license: 'OFL-1.1',
    reason: 'self-hosted UI font; its licence ships in frontend/dist/licenses/',
  },
});

/**
 * Packages whose published metadata has no usable SPDX licence although the package is properly licensed.
 * Each entry names the licence verified by hand (from the package's LICENSE file) and why it is needed.
 * @type {Readonly<Record<string, { license: string, reason: string }>>}
 */
const LICENSE_OVERRIDES = Object.freeze({});

/**
 * @typedef {{
 *   family: string,
 *   reason: string,
 *   matchesId?: (id: string) => boolean,
 *   matchesExpression?: (expression: string) => boolean,
 * }} DeniedFamily
 */

/**
 * Licence families no dependency may be used under (unless the expression also offers an allowed alternative),
 * each with the reason. A family matches an identifier the expression names (`matchesId`, by SPDX prefix, any
 * version, `-only` and `-or-later` alike) or the expression as a whole (`matchesExpression`). The allowlist and
 * the exceptions above must not match any of them (checked at start-up). Everything not allowed and not listed
 * here still fails, as "not on the allowlist"; this list exists so that the families most likely to arrive are
 * refused with a reason.
 * @type {ReadonlyArray<DeniedFamily>}
 */
const DENIED_LICENSE_FAMILIES = Object.freeze([
  {
    family: 'GPL-*',
    matchesId: (id) => /^GPL(?:-|$)/i.test(id),
    reason:
      'strong copyleft: a work that bundles or links GPL code must be distributed as a whole under the GPL, so ' +
      "gcportrait's combined work could no longer be offered under the MIT License",
  },
  {
    family: 'LGPL-*',
    matchesId: (id) => /^LGPL(?:-|$)/i.test(id),
    reason:
      'library copyleft: the combined work must allow modification and relinking of the library and keep its ' +
      "changes under the LGPL, conditions gcportrait's bundled application cannot meet without obligations",
  },
  {
    family: 'AGPL-*',
    matchesId: (id) => /^AGPL(?:-|$)/i.test(id),
    reason:
      'network copyleft: a work that includes AGPL code must be distributed as a whole under the AGPL, and its ' +
      "source offered to everyone who uses it over a network, so gcportrait's combined work could no longer be " +
      'offered under the MIT License',
  },
  {
    family: 'SSPL-*',
    matchesId: (id) => /^SSPL(?:-|$)/i.test(id),
    reason:
      'service-source copyleft: offering the program as a service requires releasing the source of the whole ' +
      'service stack under the SSPL; not an open-source licence',
  },
  {
    family: 'CC-BY-SA-*',
    matchesId: (id) => /^CC-BY-SA(?:-|$)/i.test(id),
    reason: 'share-alike: adaptations must be released under the same Creative Commons licence',
  },
  {
    family: 'CC-BY-NC-*',
    matchesId: (id) => /^CC-BY-NC(?:-|$)/i.test(id),
    reason: 'non-commercial: forbids commercial use, which would rule it out for gcportrait as well',
  },
  {
    family: 'EUPL-*',
    matchesId: (id) => /^EUPL(?:-|$)/i.test(id),
    reason:
      'copyleft that counts network use as distribution: derivative works must stay under the EUPL or a ' +
      'licence of its compatibility list',
  },
  {
    family: 'OSL-*',
    matchesId: (id) => /^OSL(?:-|$)/i.test(id),
    reason:
      'network copyleft ("external deployment"): derivative works must stay under the OSL, so the combined work ' +
      'could not be distributed under the MIT License',
  },
  {
    family: 'CPAL-*',
    matchesId: (id) => /^CPAL(?:-|$)/i.test(id),
    reason:
      'network copyleft with attribution required in the user interface: modifications must stay under the CPAL, ' +
      'so the combined work could not be distributed under the MIT License alone',
  },
  {
    family: 'EPL-*',
    matchesId: (id) => /^EPL(?:-|$)/i.test(id),
    reason:
      'module-level copyleft: modified EPL modules must stay under the EPL with their source available, an ' +
      'obligation the MIT License does not carry on to recipients of the combined work',
  },
  {
    family: 'CDDL-*',
    matchesId: (id) => /^CDDL(?:-|$)/i.test(id),
    reason:
      'file-level copyleft: CDDL files must stay under the CDDL with their source available, an obligation the ' +
      'MIT License does not carry on to recipients of the combined work',
  },
  {
    family: 'SEE LICENSE IN …',
    matchesExpression: (expression) => /^SEE LICEN[CS]E IN\b/i.test(expression.trim()),
    reason: 'custom terms in a file of the package that no tool can verify',
  },
  {
    family: 'LicenseRef-*',
    matchesId: (id) => /^LicenseRef-/i.test(id),
    reason: 'a licence defined by the package itself that no tool can verify',
  },
  {
    family: 'UNLICENSED',
    matchesExpression: (expression) => /^UNLICENSED$/i.test(expression.trim()),
    reason: 'npm\'s marker for "no permission granted": the package is proprietary',
  },
  {
    family: 'proprietary',
    matchesExpression: (expression) => /\b(?:proprietary|commercial)\b/i.test(expression),
    reason: 'proprietary or commercial terms',
  },
  {
    family: 'unknown or absent',
    matchesExpression: (expression) => /^(?:|unknown|none|NOASSERTION)$/i.test(expression.trim()),
    reason: 'no licence declared, so nothing can be verified',
  },
]);

/**
 * @typedef {{ name: string, version: string | undefined, license: string, paths: readonly string[] }} InstalledPackage
 * @typedef {{ name: string, dir: string }} WorkspaceProject
 */

/**
 * @param {string} root
 * @param {readonly string[]} args
 * @returns {string}
 */
function runPnpm(root, args) {
  return execFileSync('pnpm', [...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, npm_config_update_notifier: 'false' },
    shell: process.platform === 'win32',
  });
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What `pnpm licenses list` prints, instead of JSON, for a tree with no third-party package at all. */
const NO_LICENSES_MESSAGE = /^No licenses in packages found\b/;

/** The output of a pnpm command that cannot be read; main() reports it as a usage problem, never a stack trace. */
class PnpmOutputError extends Error {
  /** @override */
  name = 'PnpmOutputError';
}

/**
 * The JSON report of `pnpm licenses list --json`: an empty report when pnpm says there is nothing to list.
 * @param {string} output
 * @returns {unknown}
 */
export function parseLicensesReport(output) {
  const text = output.trim();
  if (text === '' || NO_LICENSES_MESSAGE.test(text)) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new PnpmOutputError(
      `unexpected output from \`pnpm licenses list --json\`: ${text.split('\n', 1)[0] ?? ''}`,
    );
  }
}

/**
 * Every installed package version with its declared licence. A package pnpm reports without a version (a
 * dependency installed from a local directory has `versions: [null]`) is still checked, once.
 * @param {string} root
 * @returns {InstalledPackage[]}
 */
function readInstalledPackages(root) {
  const report = parseLicensesReport(runPnpm(root, ['licenses', 'list', '--json']));
  if (!isRecord(report)) throw new PnpmOutputError('unexpected output from `pnpm licenses list --json`');
  /** @type {InstalledPackage[]} */
  const packages = [];
  for (const [groupLicense, entries] of Object.entries(report)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of /** @type {unknown[]} */ (entries)) {
      if (!isRecord(entry) || typeof entry.name !== 'string') continue;
      const license = typeof entry.license === 'string' ? entry.license : groupLicense;
      const paths = (Array.isArray(entry.paths) ? entry.paths : []).filter(
        /** @returns {entryPath is string} */ (entryPath) => typeof entryPath === 'string',
      );
      const versions = (Array.isArray(entry.versions) ? entry.versions : []).map((version) =>
        typeof version === 'string' ? version : undefined,
      );
      for (const version of new Set(versions.length > 0 ? versions : [undefined])) {
        packages.push({ name: entry.name, version, license, paths });
      }
    }
  }
  return packages;
}

/**
 * @param {string} root
 * @returns {WorkspaceProject[]}
 */
function readWorkspaceProjects(root) {
  /** @type {unknown} */
  let projects;
  try {
    projects = JSON.parse(runPnpm(root, ['ls', '-r', '--depth', '-1', '--json']));
  } catch {
    projects = undefined;
  }
  if (!Array.isArray(projects)) throw new PnpmOutputError('unexpected output from `pnpm ls -r --json`');
  /** @type {WorkspaceProject[]} */
  const result = [];
  for (const project of /** @type {unknown[]} */ (projects)) {
    if (isRecord(project) && typeof project.name === 'string' && typeof project.path === 'string') {
      result.push({ name: project.name, dir: project.path });
    }
  }
  return result;
}

/**
 * The workspace projects whose package.json does not declare the project licence (the root package.json's
 * `license`): gcportrait's own packages are all under it, so a different or a missing one is a mistake.
 * @param {string} root
 * @param {readonly WorkspaceProject[]} projects
 * @param {string} projectLicense
 * @returns {string[]}
 */
function workspaceLicenseProblems(root, projects, projectLicense) {
  /** @type {string[]} */
  const problems = [];
  for (const project of projects) {
    const manifestPath = path.join(project.dir, 'package.json');
    /** @type {unknown} */
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const declared = isRecord(manifest) ? manifest.license : undefined;
    if (declared === projectLicense) continue;
    const where = path.relative(root, manifestPath).split(path.sep).join('/');
    problems.push(
      typeof declared === 'string'
        ? `${project.name} (${where}): license "${declared}" differs from the project licence "${projectLicense}" of the root package.json`
        : `${project.name} (${where}): no license field; every workspace package declares the project licence "${projectLicense}"`,
    );
  }
  return problems;
}

/**
 * Whether pnpm reports this package from a workspace project's own directory, i.e. it is gcportrait's own code
 * under the project licence and not a dependency. Decided by path, never by name: a third-party package that
 * happens to share a workspace project's name is installed under node_modules and is checked like any other.
 * @param {InstalledPackage} pkg
 * @param {ReadonlySet<string>} projectDirs real paths of the workspace projects
 * @returns {boolean}
 */
function isWorkspaceProject(pkg, projectDirs) {
  return pkg.paths.length > 0 && pkg.paths.every((dir) => projectDirs.has(path.resolve(dir)));
}

/**
 * @param {string} name
 * @param {string} license
 * @returns {string}
 */
function effectiveLicense(name, license) {
  return LICENSE_OVERRIDES[name]?.license ?? license;
}

/**
 * The first denied family a licence expression falls into, or undefined.
 * @param {string} expression
 * @returns {DeniedFamily | undefined}
 */
function deniedFamilyOf(expression) {
  const ids = licenseIdsOf(expression);
  return DENIED_LICENSE_FAMILIES.find(
    (family) =>
      family.matchesExpression?.(expression) === true ||
      (family.matchesId !== undefined && ids.some((id) => family.matchesId?.(id) === true)),
  );
}

/**
 * Fails loudly if the allowlist or an exception overlaps the deny list: a programming error in this file.
 */
function assertListsDisjoint() {
  const accepted = [...ALLOWED_LICENSES, ...Object.values(PACKAGE_LICENSE_EXCEPTIONS).map((e) => e.license)];
  for (const license of accepted) {
    const family = deniedFamilyOf(license);
    if (family !== undefined) throw new Error(`${license} is both accepted and denied (${family.family})`);
  }
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function byCodePoint(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The one-line compatibility statement the report prints (and THIRD_PARTY.md explains at length).
 * @param {string} projectLicense
 * @returns {string}
 */
function compatibilityStatement(projectLicense) {
  return (
    'every accepted dependency licence is permissive, file-scoped weak copyleft (MPL-2.0) or, for the self-hosted ' +
    `font packages only, OFL-1.1; all are compatible with ${projectLicense}, and none requires gcportrait to ` +
    'publish its code or relicense its combined work.'
  );
}

/**
 * The generated Markdown section listing every direct dependency of every workspace project.
 * Versions are deliberately left out so that routine version bumps do not make the file stale.
 * @param {string} root
 * @param {readonly WorkspaceProject[]} projects
 * @param {readonly InstalledPackage[]} installed
 * @returns {{ markdown: string, problems: string[] }}
 */
function renderDependencySection(root, projects, installed) {
  const workspaceNames = new Set(projects.map((project) => project.name));
  const thirdPartyNames = new Set(installed.map((pkg) => pkg.name));
  /** @type {Map<string, Set<string>>} */
  const licensesByName = new Map();
  for (const pkg of installed) {
    const licenses = licensesByName.get(pkg.name) ?? new Set();
    licenses.add(effectiveLicense(pkg.name, pkg.license));
    licensesByName.set(pkg.name, licenses);
  }

  /** @type {Map<string, { usedBy: Set<string>, kinds: Set<string> }>} */
  const rows = new Map();
  const fields = /** @type {const} */ ([
    ['dependencies', 'runtime'],
    ['optionalDependencies', 'runtime'],
    ['devDependencies', 'dev'],
  ]);
  for (const project of projects) {
    /** @type {unknown} */
    const manifest = JSON.parse(readFileSync(path.join(project.dir, 'package.json'), 'utf8'));
    if (!isRecord(manifest)) continue;
    const label = path.relative(root, project.dir).split(path.sep).join('/') || '(root)';
    for (const [field, kind] of fields) {
      const deps = manifest[field];
      if (!isRecord(deps)) continue;
      for (const [name, spec] of Object.entries(deps)) {
        // A workspace project, not a dependency, unless a third-party package of that name is installed.
        if (typeof spec === 'string' && spec.startsWith('workspace:')) continue;
        if (workspaceNames.has(name) && !thirdPartyNames.has(name)) continue;
        const row = rows.get(name) ?? { usedBy: new Set(), kinds: new Set() };
        row.usedBy.add(label);
        row.kinds.add(kind);
        rows.set(name, row);
      }
    }
  }

  /** @type {string[]} */
  const problems = [];
  const lines = [
    BEGIN_MARKER,
    '',
    `${String(rows.size)} direct dependencies across ${String(projects.length)} workspace projects. "runtime" means`,
    '`dependencies`/`optionalDependencies`, "dev" means `devDependencies`. Transitive dependencies are not listed',
    'here but are checked against the same allowlist and deny list on every run.',
    '',
    '| Package | Licence | Used by | As |',
    '| --- | --- | --- | --- |',
  ];
  for (const name of [...rows.keys()].sort(byCodePoint)) {
    const row = rows.get(name);
    if (row === undefined) continue;
    const licenses = [...(licensesByName.get(name) ?? [])].sort(byCodePoint);
    if (licenses.length === 0) problems.push(`${name}: listed in a package.json but not installed`);
    lines.push(
      `| \`${name}\` | ${licenses.join(', ') || 'not installed'} | ${[...row.usedBy].sort(byCodePoint).join(', ')} | ` +
        `${[...row.kinds].sort(byCodePoint).join(', ')} |`,
    );
  }
  lines.push('', END_MARKER);
  return { markdown: lines.join('\n'), problems };
}

/**
 * @param {string} document
 * @returns {{ before: string, section: string, after: string } | undefined}
 */
function splitDocument(document) {
  const begin = document.indexOf(BEGIN_MARKER);
  const end = document.indexOf(END_MARKER);
  if (begin < 0 || end < begin) return undefined;
  return {
    before: document.slice(0, begin),
    section: document.slice(begin, end + END_MARKER.length),
    after: document.slice(end + END_MARKER.length),
  };
}

/** @returns {string} */
function describeRules() {
  return [
    'Dependency licence rules (scripts/check-licenses.mjs)',
    '',
    `Allowed: ${ALLOWED_LICENSES.join(', ')}.`,
    'Per-package exceptions:',
    ...Object.entries(PACKAGE_LICENSE_EXCEPTIONS).map(
      ([name, { license, reason }]) => `  ${name}: ${license} (${reason})`,
    ),
    `Denied (${DENIED_MESSAGE}):`,
    ...DENIED_LICENSE_FAMILIES.map(({ family, reason }) => `  ${family}: ${reason}`),
    'Anything else that is not allowed fails as "not on the allowlist". An expression with an allowed',
    'alternative ("MIT OR GPL-3.0-only") passes.',
  ].join('\n');
}

/**
 * @param {InstalledPackage} pkg
 * @returns {string}
 */
function packageLabel(pkg) {
  return pkg.version === undefined ? `${pkg.name} (local, no version)` : `${pkg.name}@${pkg.version}`;
}

/**
 * @param {readonly string[]} argv
 * @returns {number} exit code
 */
function main(argv) {
  /** @type {{ write: boolean, listRules: boolean, root: string }} */
  let options;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        write: { type: 'boolean' },
        'list-rules': { type: 'boolean' },
        root: { type: 'string' },
      },
      strict: true,
    });
    options = {
      write: values.write === true,
      listRules: values['list-rules'] === true,
      // pnpm reports real paths, so the root must be one too (a temporary directory may sit behind a link).
      root: realpathSync(path.resolve(values.root ?? DEFAULT_ROOT)),
    };
  } catch (error) {
    console.error(`licenses: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  assertListsDisjoint();
  if (options.listRules) {
    console.log(describeRules());
    return 0;
  }
  const { root } = options;
  const thirdPartyPath = path.join(root, 'THIRD_PARTY.md');
  if (!existsSync(path.join(root, 'node_modules'))) {
    console.error('licenses: node_modules is missing; run `pnpm install` first.');
    return 1;
  }

  const projectLicense = readProjectLicenseId(root);
  console.log(`licenses: project licence ${projectLicense} (the "license" field of the root package.json).`);

  /** @type {WorkspaceProject[]} */
  let projects;
  /** @type {InstalledPackage[]} */
  let installed;
  try {
    projects = readWorkspaceProjects(root);
    const projectDirs = new Set(projects.map((project) => path.resolve(project.dir)));
    // The workspace's own packages are gcportrait's code, under the project licence, not dependencies.
    installed = readInstalledPackages(root).filter((pkg) => !isWorkspaceProject(pkg, projectDirs));
  } catch (error) {
    if (!(error instanceof PnpmOutputError)) throw error;
    console.error(`licenses: ${error.message}`);
    return 2;
  }
  /** @type {string[]} */
  const violations = [];
  for (const pkg of installed) {
    const license = effectiveLicense(pkg.name, pkg.license);
    if (isLicenseAllowed(license, ALLOWED_LICENSES)) continue;
    if (PACKAGE_LICENSE_EXCEPTIONS[pkg.name]?.license === license) continue;
    const declared = license === pkg.license ? '' : ` (LICENSE_OVERRIDES entry; declared "${pkg.license}")`;
    const denied = deniedFamilyOf(license);
    violations.push(
      denied === undefined
        ? `  ${packageLabel(pkg)}: "${license}"${declared} is not on the allowlist`
        : `  ${packageLabel(pkg)}: "${license}"${declared} is denied (${denied.family}: ${denied.reason}); ` +
            DENIED_MESSAGE,
    );
  }

  const { markdown, problems } = renderDependencySection(root, projects, installed);
  const document = existsSync(thirdPartyPath) ? readFileSync(thirdPartyPath, 'utf8') : '';
  const parts = splitDocument(document);
  /** @type {string[]} */
  const staleness = [];
  if (parts === undefined) {
    staleness.push(`  THIRD_PARTY.md is missing or lacks the markers "${BEGIN_MARKER}" … "${END_MARKER}"`);
  } else if (options.write) {
    if (parts.section !== markdown) writeFileSync(thirdPartyPath, `${parts.before}${markdown}${parts.after}`);
    console.log('licenses: THIRD_PARTY.md dependency section regenerated.');
  } else if (parts.section !== markdown) {
    staleness.push('  THIRD_PARTY.md is stale; run `pnpm run licenses --write` and commit the result');
  }

  const ownLicences = workspaceLicenseProblems(root, projects, projectLicense);
  const failures = [
    ...violations,
    ...ownLicences.map((problem) => `  ${problem}`),
    ...problems.map((problem) => `  ${problem}`),
    ...staleness,
  ];
  if (failures.length > 0) {
    console.error(`licenses: FAILED with ${String(failures.length)} problem(s):`);
    for (const failure of failures) console.error(failure);
    console.error(`Allowed licences: ${ALLOWED_LICENSES.join(', ')}.`);
    console.error(
      `Per-package exceptions: ${Object.entries(PACKAGE_LICENSE_EXCEPTIONS)
        .map(([name, { license }]) => `${name} (${license})`)
        .join(', ')}.`,
    );
    console.error(
      `Denied families: ${DENIED_LICENSE_FAMILIES.map(({ family }) => family).join(', ')} ` +
        '(`node scripts/check-licenses.mjs --list-rules` gives the reasons).',
    );
    return 1;
  }
  console.log(`licenses: compatibility: ${compatibilityStatement(projectLicense)}`);
  console.log(
    `licenses: OK. ${String(installed.length)} installed packages are under allowed licences; ` +
      `the workspace packages (${String(projects.length)}) declare ${projectLicense}; THIRD_PARTY.md is up to date.`,
  );
  return 0;
}

// Run as a script only, so that the tests can import the helpers above.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
