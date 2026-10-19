// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * Sets the version of the whole tree: the root package.json and every workspace package's, which carry one
 * fixed version (AGENTS.md, Releases) and are private, never published to npm. A release is one command after
 * the maintainer has read the commits since the last tag and chosen the bump; the release notes come from
 * those commits (scripts/release-notes.mjs), so no pull request has to add a file of its own.
 *
 * What it does, in the tree rooted at the repository (or --root):
 *   1. reads pnpm-workspace.yaml's package list (scripts/lib/workspace-packages.mjs) and takes the root's
 *      package.json and each package's;
 *   2. rewrites the top-level "version" field of each, keeping the file's formatting, and fails without
 *      writing anything when a manifest has no version field or a rewrite would not read back.
 *
 * Usage:
 *   node scripts/set-version.mjs <X.Y.Z[-SUFFIX]> [--dry-run] [--root <dir>]
 *
 * Exit code 0 on success, 2 on a usage error. Plain ESM, Node built-ins only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { workspaceDirs } from './lib/workspace-packages.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** A version the release may carry: X.Y.Z, with an optional pre-release suffix. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

class UsageError extends Error {}

/**
 * The root-relative path of every manifest that carries the fixed version: the root's and the workspace
 * packages'.
 * @param {string} root
 * @returns {string[]}
 */
export function manifestsOf(root) {
  return ['package.json', ...workspaceDirs(root).map((dir) => `${dir}/package.json`)];
}

/**
 * A manifest's text with its top-level "version" set, or undefined when the field is not there or the
 * rewritten text does not read back as the same manifest with the new version.
 * @param {string} text
 * @param {string} version
 * @returns {string | undefined}
 */
export function withVersion(text, version) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const before = /** @type {{ version?: unknown }} */ (parsed);
  if (typeof before.version !== 'string') return undefined;
  const rewritten = text.replace(/("version"\s*:\s*)"[^"]*"/, (_match, /** @type {string} */ key) => {
    return `${key}${JSON.stringify(version)}`;
  });
  /** @type {unknown} */
  const after = JSON.parse(rewritten);
  if (typeof after !== 'object' || after === null) return undefined;
  /** @type {{ version?: unknown }} */
  const manifest = after;
  if (manifest.version !== version) return undefined;
  if (withoutVersion(manifest) !== withoutVersion(before)) return undefined;
  return rewritten;
}

/**
 * A manifest's entries other than its version, as JSON, to tell whether a rewrite changed anything else.
 * @param {{ version?: unknown }} manifest
 * @returns {string}
 */
function withoutVersion(manifest) {
  /** @type {{ version?: unknown }} */
  const rest = { ...manifest };
  delete rest.version;
  return JSON.stringify(rest);
}

/**
 * @param {readonly string[]} argv
 * @returns {{ version: string, dryRun: boolean, root: string }}
 */
function parseOptions(argv) {
  const parsed = (() => {
    try {
      return parseArgs({
        args: [...argv],
        options: { 'dry-run': { type: 'boolean' }, root: { type: 'string' } },
        allowPositionals: true,
        strict: true,
      });
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error));
    }
  })();
  const [version, ...extra] = parsed.positionals;
  if (version === undefined || extra.length > 0) {
    throw new UsageError('expected exactly one version, e.g. `1.1.0`');
  }
  if (!VERSION.test(version)) {
    throw new UsageError(`"${version}" is not a version of the form X.Y.Z or X.Y.Z-SUFFIX`);
  }
  return {
    version,
    dryRun: parsed.values['dry-run'] === true,
    root: path.resolve(parsed.values.root ?? path.join(SCRIPT_DIR, '..')),
  };
}

/**
 * @param {readonly string[]} argv
 * @returns {number} exit code
 */
export function run(argv) {
  /** @type {{ version: string, dryRun: boolean, root: string }} */
  let options;
  /** @type {Array<{ absPath: string, text: string }>} */
  let writes;
  try {
    options = parseOptions(argv);
    writes = manifestsOf(options.root).map((relPath) => {
      const absPath = path.join(options.root, relPath);
      if (!existsSync(absPath)) throw new UsageError(`no manifest at ${relPath}`);
      const text = withVersion(readFileSync(absPath, 'utf8'), options.version);
      if (text === undefined) {
        throw new UsageError(
          `${relPath} is not JSON with a top-level "version" field, or its version would not read back`,
        );
      }
      return { absPath, text };
    });
  } catch (error) {
    console.error(`set-version: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (!options.dryRun) {
    for (const write of writes) writeFileSync(write.absPath, write.text);
  }
  console.log(
    `set-version: ${options.dryRun ? 'would set' : 'set'} the version to ${options.version} in ` +
      `${String(writes.length)} package.json file(s)` +
      (options.dryRun ? '. Dry run: nothing was written.' : '.'),
  );
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
