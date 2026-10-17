// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Applies a project licence to the whole tree. gcportrait is MIT (AGENTS.md, Licence and dependencies), so
 * this is needed only if the project licence changes. LICENSE carries a closing note written by hand, on what
 * the MIT License does not cover (the gcportrait name and icon, brand/LICENSE.md; the third-party material,
 * THIRD_PARTY.md); a run writes the bare licence text, so the note has to be put back after it.
 *
 * What it does, in the tree rooted at the repository (or --root):
 *   1. rewrites every SPDX header line that carries the current project licence identifier (the "license"
 *      field of the root package.json, MIT) to the new identifier, using the same file walk and header rules
 *      as scripts/check-provenance.mjs;
 *   2. sets the "license" field of every package.json that carries the current identifier;
 *   3. writes LICENSE from the built-in text in scripts/licenses/<id>.txt (Apache-2.0, MIT) or
 *      from --text <file> for any other identifier. Nothing is fetched.
 *
 * Usage:
 *   node scripts/set-license.mjs <SPDX-ID> [--holder <name>] [--year <yyyy>] [--text <file>] [--dry-run] [--root <dir>]
 *
 *   --holder   copyright holder, required for MIT (fills "<copyright holders>")
 *   --year     copyright year for MIT (default: the current year)
 *   --text     licence text to use for an identifier without a built-in text
 *   --dry-run  report what would change and write nothing
 *
 * Exit code 0 on success, 2 on a usage error. Plain ESM, Node built-ins only.
 */
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  findHeader,
  headerLine,
  headerStyleFor,
  isBinary,
  listRepoFiles,
  readProjectLicenseId,
  splitLines,
} from './lib/repo-files.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Identifiers with a canonical licence text shipped in scripts/licenses/. */
const BUILT_IN_TEXTS = Object.freeze(['Apache-2.0', 'MIT']);

/** A single SPDX licence identifier (including LicenseRef-…); expressions with AND/OR are not accepted. */
const SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

class UsageError extends Error {}

/**
 * @typedef {{
 *   licenseId: string,
 *   holder: string | undefined,
 *   year: string,
 *   textFile: string | undefined,
 *   dryRun: boolean,
 *   root: string,
 * }} Options
 */

/**
 * @param {readonly string[]} argv
 * @returns {Options}
 */
function parseOptions(argv) {
  const parsed = (() => {
    try {
      return parseArgs({
        args: [...argv],
        options: {
          holder: { type: 'string' },
          year: { type: 'string' },
          text: { type: 'string' },
          'dry-run': { type: 'boolean' },
          root: { type: 'string' },
        },
        allowPositionals: true,
        strict: true,
      });
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error));
    }
  })();
  const [licenseId, ...extra] = parsed.positionals;
  if (licenseId === undefined || extra.length > 0) {
    throw new UsageError('expected exactly one SPDX licence identifier, e.g. `MIT`');
  }
  if (!SPDX_ID.test(licenseId)) {
    throw new UsageError(`"${licenseId}" is not a single SPDX licence identifier`);
  }
  const year = parsed.values.year ?? String(new Date().getUTCFullYear());
  if (!/^\d{4}$/.test(year)) throw new UsageError(`--year must be a four-digit year, got "${year}"`);
  const holder = parsed.values.holder?.trim();
  return {
    licenseId,
    holder: holder === '' ? undefined : holder,
    year,
    textFile: parsed.values.text,
    dryRun: parsed.values['dry-run'] === true,
    root: path.resolve(parsed.values.root ?? path.join(SCRIPT_DIR, '..')),
  };
}

/**
 * The LICENSE file content for the chosen identifier.
 * @param {Options} options
 * @returns {string}
 */
function licenseText(options) {
  if (options.textFile !== undefined) {
    const textPath = path.resolve(options.textFile);
    if (!existsSync(textPath)) throw new UsageError(`--text file not found: ${textPath}`);
    return readFileSync(textPath, 'utf8');
  }
  if (!BUILT_IN_TEXTS.includes(options.licenseId)) {
    throw new UsageError(
      `no built-in text for "${options.licenseId}" (built in: ${BUILT_IN_TEXTS.join(', ')}); pass --text <file>`,
    );
  }
  const text = readFileSync(path.join(SCRIPT_DIR, 'licenses', `${options.licenseId}.txt`), 'utf8');
  if (options.licenseId !== 'MIT') return text;
  if (options.holder === undefined) throw new UsageError('MIT needs --holder "<copyright holder>"');
  return text.replace('<year>', options.year).replace('<copyright holders>', options.holder);
}

/**
 * Rewrites the SPDX header of one file if it carries `fromId`.
 * @param {string} relPath
 * @param {string} text
 * @param {string} fromId
 * @param {string} toId
 * @returns {{ status: 'rewritten', text: string } | { status: 'other-id', foundId: string } | { status: 'no-header' } | { status: 'not-source' }}
 */
function rewriteHeader(relPath, text, fromId, toId) {
  const style = headerStyleFor(relPath);
  if (style === undefined) return { status: 'not-source' };
  const lines = splitLines(text);
  const found = findHeader(lines, relPath, style);
  if (found === undefined) return { status: 'no-header' };
  if (found.licenseId !== fromId) return { status: 'other-id', foundId: found.licenseId };
  lines[found.index] = headerLine(style, toId);
  return { status: 'rewritten', text: lines.join(text.includes('\r\n') ? '\r\n' : '\n') };
}

/**
 * Sets the top-level "license" field of a package.json text, keeping its formatting.
 * @param {string} text
 * @param {string} fromId
 * @param {string} toId
 * @returns {string | undefined} the new text, or undefined when the field does not carry `fromId`
 */
function rewriteManifest(text, fromId, toId) {
  /** @type {unknown} */
  const manifest = JSON.parse(text);
  if (typeof manifest !== 'object' || manifest === null || !('license' in manifest)) return undefined;
  if (manifest.license !== fromId) return undefined;
  const pattern = /("license"\s*:\s*)"[^"]*"/;
  return text.replace(pattern, (_match, /** @type {string} */ key) => `${key}${JSON.stringify(toId)}`);
}

/**
 * @param {readonly string[]} argv
 * @returns {number} exit code
 */
function main(argv) {
  /** @type {Options} */
  let options;
  /** @type {string} */
  let text;
  /** @type {string} */
  let fromId;
  try {
    options = parseOptions(argv);
    fromId = readProjectLicenseId(options.root);
    const license = lstatSync(path.join(options.root, 'LICENSE'), { throwIfNoEntry: false });
    if (license !== undefined && !license.isFile())
      throw new UsageError('LICENSE must be a regular file; symbolic links are not allowed');
    text = licenseText(options);
  } catch (error) {
    console.error(`set-license: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  /** @type {Array<{ absPath: string, text: string }>} */
  const writes = [];
  let headers = 0;
  let manifests = 0;
  /** @type {string[]} */
  const notes = [];

  for (const { absPath, relPath, isSymlink } of listRepoFiles(options.root)) {
    // Links are never rewritten through: the provenance check reports them, and following one could
    // rewrite a file outside the tree.
    if (isSymlink) continue;
    const content = readFileSync(absPath);
    if (isBinary(relPath, content)) continue;
    const original = content.toString('utf8');
    if (path.posix.basename(relPath) === 'package.json') {
      const updated = rewriteManifest(original, fromId, options.licenseId);
      if (updated !== undefined && updated !== original) {
        writes.push({ absPath, text: updated });
        manifests += 1;
      }
      continue;
    }
    const result = rewriteHeader(relPath, original, fromId, options.licenseId);
    if (result.status === 'rewritten') {
      if (result.text !== original) writes.push({ absPath, text: result.text });
      headers += 1;
    } else if (result.status === 'other-id') {
      notes.push(`  ${relPath}: header names "${result.foundId}", left unchanged`);
    }
  }

  if (!options.dryRun) {
    for (const write of writes) writeFileSync(write.absPath, write.text);
    writeFileSync(path.join(options.root, 'LICENSE'), text);
  }

  const verb = options.dryRun ? 'would rewrite' : 'rewrote';
  console.log(
    `set-license: ${fromId} -> ${options.licenseId}: ${verb} ${String(headers)} SPDX header(s) and ` +
      `${String(manifests)} package.json licence field(s); ` +
      `${options.dryRun ? 'would write' : 'wrote'} LICENSE (${String(text.length)} characters).` +
      (options.dryRun ? ' Dry run: nothing was written.' : ''),
  );
  if (notes.length > 0) {
    console.log('Files whose header carries another identifier (not touched):');
    for (const note of notes) console.log(note);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
