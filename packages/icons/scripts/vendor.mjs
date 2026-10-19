#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * Vendors the Google Cloud product icons, as Google Cloud provides them at https://cloud.google.com/icons, into
 * packages/icons (the icons stay Google Cloud's; README "Trademark, usage terms and copyright"):
 *
 *  1. downloads the three ZIP files that page links (core product colour marks, legacy console icons,
 *     product category marks; the URLs are in mapping.json) or reads them from `--zips <dir>`;
 *  2. unzips their SVG entries into a temporary directory;
 *  3. picks one artwork per icon key from mapping.json, in fallback order (own drawing, core colour mark,
 *     legacy two-tone icon, category mark), for every key the asset catalog uses (its product files and
 *     icon-keys.json), every key mapping.json lists, and every category mark;
 *  4. applies the mechanical transforms of lib/svg.mjs (never an artwork change), checks that no colour was
 *     added, no drawing element lost and no file exceeds 8 kB, optionally (`--verify-render`) that Chromium
 *     draws every source and its transform with identical pixels;
 *  5. writes vendored/<file>.svg and manifest.json (key → file, set, source entry, byte sizes and SHA-256 of the
 *     raw and the transformed file, colours, vendored date) and deletes vendored files nothing uses any more;
 *  6. writes archive-index.json: every SVG entry of each archive with its SHA-256, the baseline drift.mjs
 *     compares the archives on the page with (a new icon nothing uses yet still counts as seen once vendored).
 *
 * Re-runnable and deterministic: the same ZIP contents give byte-identical output. A file keeps the date it was
 * first vendored while its raw and transformed hashes stay the same; a new or changed file gets `--date`
 * (default: today in UTC).
 *
 * Usage:
 *   node scripts/vendor.mjs [--zips <dir>] [--date YYYY-MM-DD] [--check] [--verify-render] [--keep-temp]
 *     --zips <dir>      read <dir>/<file name of each URL> instead of downloading
 *     --check           write nothing; exit 1 when vendored/, manifest.json or archive-index.json would change
 *     --verify-render   rasterise each source and its transform in Chromium (playwright-core) and require equal pixels
 *     --keep-temp       keep the temporary directory with the unzipped sets and print its path
 * Exit codes: 0 done (or up to date with --check), 1 a failure or a difference, 2 a usage error.
 */
import { Buffer } from 'node:buffer';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { INDEX_PATH, archiveIndex } from './lib/archive-index.mjs';
import { fetchArchive, inventoryOf, sha256, svgEntries, writeEntries } from './lib/archives.mjs';
import { catalogIconKeys } from './lib/catalog-keys.mjs';
import { formatJson } from './lib/format.mjs';
import { MANIFEST_PATH, VENDORED_DIR, readManifest } from './lib/manifest.mjs';
import { MAX_ICON_BYTES, SETS, genericKey, loadMapping } from './lib/mapping.mjs';
import { compareRenders } from './lib/render.mjs';
import { coloursOf, drawingElementCount, transformIcon } from './lib/svg.mjs';

/** @param {string} line */
const say = (line) => process.stdout.write(`${line}\n`);
/** @param {string} line */
const warn = (line) => process.stderr.write(`${line}\n`);

/**
 * @typedef {import('./lib/mapping.mjs').SetName} SetName
 * @typedef {import('./lib/manifest.mjs').Manifest} Manifest
 * @typedef {import('./lib/manifest.mjs').ManifestFile} ManifestFile
 * @typedef {import('./lib/manifest.mjs').ManifestIcon} ManifestIcon
 * @typedef {import('./lib/manifest.mjs').ManifestSource} ManifestSource
 * @typedef {import('./lib/archive-index.mjs').IndexedArchive} IndexedArchive
 */

/**
 * @param {readonly string[]} argv
 */
function parseCli(argv) {
  return parseArgs({
    args: [...argv],
    options: {
      zips: { type: 'string' },
      date: { type: 'string' },
      check: { type: 'boolean', default: false },
      'verify-render': { type: 'boolean', default: false },
      'keep-temp': { type: 'boolean', default: false },
    },
    strict: true,
  });
}

/**
 * @param {string} name
 * @returns {string}
 */
function idPrefixOf(name) {
  return `icon-${name.replace(/\.svg$/, '').replaceAll('_', '-')}`;
}

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  /** @type {ReturnType<typeof parseCli>} */
  let cli;
  try {
    cli = parseCli(argv);
  } catch (error) {
    warn(`vendor: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const { zips, check } = cli.values;
  const today = cli.values.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    warn('vendor: --date must be YYYY-MM-DD');
    return 2;
  }

  const mapping = loadMapping();
  const generic = genericKey(mapping);
  const previous = readManifest();

  // Every key the catalog uses must have a mapping entry.
  const catalogKeys = catalogIconKeys();
  const unmapped = catalogKeys.filter((key) => !(key in mapping.icons));
  if (unmapped.length > 0) {
    warn(`vendor: the catalog uses icon keys mapping.json does not map: ${unmapped.join(', ')}`);
    warn('  add each to mapping.json "icons" (own, core, legacy and/or category), then run vendor again.');
    return 1;
  }

  const temp = mkdtempSync(path.join(tmpdir(), 'gcportrait-icons-'));
  try {
    say(`vendor: sources (${today})`);
    /** @type {Record<string, Set<string>>} */
    const available = {};
    /** @type {Partial<Record<SetName, ManifestSource>>} */
    const sources = {};
    /** @type {Partial<Record<SetName, IndexedArchive>>} */
    const indexed = {};
    for (const set of SETS) {
      const { url } = mapping.sources[set];
      const archive = await fetchArchive(url, zips, say);
      const digest = sha256(archive);
      const before = previous?.sources[set];
      sources[set] = {
        url,
        bytes: archive.length,
        sha256: digest,
        date: before?.sha256 === digest && before.url === url ? before.date : today,
      };
      const entries = svgEntries(archive);
      available[set] = new Set(writeEntries(entries, path.join(temp, set)));
      indexed[set] = { url, bytes: archive.length, sha256: digest, entries: inventoryOf(entries) };
      say(`    ${set}: ${String(available[set].size)} SVG files, sha256 ${digest.slice(0, 16)}…`);
    }

    // Pick one artwork per key.
    /** @type {Map<string, { set: SetName, source: string }>} */
    const artwork = new Map();
    /** @type {Record<string, ManifestIcon>} */
    const icons = {};
    /** @type {string[]} */
    const fallbacks = [];
    const add = (/** @type {string} */ file, /** @type {SetName} */ set, /** @type {string} */ source) => {
      const existing = artwork.get(file);
      if (existing !== undefined && (existing.set !== set || existing.source !== source)) {
        throw new Error(`${file} would hold two different artworks`);
      }
      artwork.set(file, { set, source });
    };
    for (const [key, source] of Object.entries(mapping.categories)) {
      if (!available.category?.has(source))
        throw new Error(`category mark ${key}: "${source}" is not in the category set`);
      add(`${key}.svg`, 'category', source);
      icons[key] = { file: `${key}.svg`, kind: 'category' };
    }
    for (const [key, entry] of Object.entries(mapping.icons).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (entry.own !== undefined) continue;
      /** @type {SetName | undefined} */
      let chosen;
      /** @type {string[]} */
      const missing = [];
      for (const set of /** @type {const} */ (['core', 'legacy'])) {
        const source = entry[set];
        if (source === undefined) continue;
        if (available[set]?.has(source)) {
          chosen = set;
          add(`${key}.svg`, set, source);
          icons[key] = { file: `${key}.svg`, kind: key === generic ? 'generic' : 'official' };
          break;
        }
        missing.push(`${set} "${source}"`);
      }
      if (chosen === undefined) {
        if (entry.category === undefined) throw new Error(`${key}: no artwork found (${missing.join(', ')})`);
        icons[key] = { file: `${entry.category}.svg`, kind: 'category' };
      }
      if (missing.length > 0)
        fallbacks.push(
          `${key}: ${missing.join(', ')} missing upstream; using ${chosen ?? entry.category ?? '?'}`,
        );
    }

    // Transform and check.
    /** @type {Record<string, ManifestFile>} */
    const files = {};
    /** @type {Map<string, string>} */
    const outputs = new Map();
    /** @type {Array<readonly [string, string]>} */
    const renderPairs = [];
    /** @type {string[]} */
    const problems = [];
    for (const [file, { set, source }] of [...artwork].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const raw = readFileSync(path.join(temp, set, ...source.split('/')));
      const rawText = raw.toString('utf8');
      /** @type {ReturnType<typeof transformIcon>} */
      let result;
      try {
        result = transformIcon(rawText, {
          idPrefix: idPrefixOf(file),
          viewBoxSize: mapping.sources[set].viewBox,
        });
      } catch (error) {
        problems.push(
          `${file} (${set} "${source}"): ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      const content = `${result.svg}\n`;
      const rawColours = coloursOf(rawText);
      const colours = coloursOf(result.svg);
      const added = colours.filter((colour) => !rawColours.includes(colour));
      if (added.length > 0) problems.push(`${file}: the transform added colours ${added.join(', ')}`);
      if (drawingElementCount(rawText) !== drawingElementCount(result.svg)) {
        problems.push(`${file}: the transform changed the number of drawing elements`);
      }
      const bytes = Buffer.byteLength(content);
      if (bytes > MAX_ICON_BYTES)
        problems.push(`${file}: ${String(bytes)} bytes, above the ${String(MAX_ICON_BYTES)}-byte limit`);
      const rawEntry = { bytes: raw.length, sha256: sha256(raw) };
      const vendoredEntry = { bytes, sha256: sha256(content) };
      const before = previous?.files[file];
      const unchanged =
        before?.raw.sha256 === rawEntry.sha256 &&
        before.vendored.sha256 === vendoredEntry.sha256 &&
        before.set === set;
      files[file] = {
        set,
        source,
        viewBox: result.viewBox,
        raw: rawEntry,
        vendored: vendoredEntry,
        colours,
        date: unchanged ? before.date : today,
      };
      outputs.set(file, content);
      renderPairs.push([rawText, result.svg]);
    }
    if (problems.length > 0) {
      warn(`vendor: FAILED\n  ${problems.join('\n  ')}`);
      return 1;
    }

    if (cli.values['verify-render']) {
      say(
        `vendor: comparing ${String(renderPairs.length)} sources with their transforms in Chromium at 16, 24 and 96 px`,
      );
      const names = [...outputs.keys()];
      for (const size of [16, 24, 96]) {
        const worst = await compareRenders(renderPairs, size);
        const different = worst.flatMap((value, i) =>
          value === 0 ? [] : [`${String(names[i])} (${String(value)})`],
        );
        if (different.length > 0) {
          warn(`vendor: FAILED: rendered pixels differ at ${String(size)} px: ${different.join(', ')}`);
          return 1;
        }
      }
      say('  every transform renders pixel-identical to its source');
    }

    /** @type {Manifest} */
    const manifest = {
      description:
        "Generated by scripts/vendor.mjs from mapping.json and Google's icon sets; do not edit by hand. 'sources' are the ZIP files downloaded from the links on https://cloud.google.com/icons, 'files' the vendored SVG files (raw: as Google ships them; vendored: after the mechanical transforms, which never change artwork), 'icons' maps each icon key whose artwork is vendored to its file. Own drawings are not vendored (see mapping.json and own/).",
      sources: /** @type {Record<SetName, ManifestSource>} */ (sources),
      files,
      icons: Object.fromEntries(Object.entries(icons).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    };
    const manifestText = await formatJson(MANIFEST_PATH, manifest);
    const indexText = await formatJson(
      INDEX_PATH,
      archiveIndex(/** @type {Record<SetName, IndexedArchive>} */ (indexed)),
    );

    // Write or compare.
    const stale = readdirSync(VENDORED_DIR).filter((name) => name.endsWith('.svg') && !outputs.has(name));
    /** @type {string[]} */
    const changes = [];
    for (const [file, content] of outputs) {
      const target = path.join(VENDORED_DIR, file);
      if (!existsSync(target) || readFileSync(target, 'utf8') !== content) changes.push(`vendored/${file}`);
    }
    for (const name of stale) changes.push(`vendored/${name} (removed)`);
    if (!existsSync(MANIFEST_PATH) || readFileSync(MANIFEST_PATH, 'utf8') !== manifestText)
      changes.push('manifest.json');
    if (!existsSync(INDEX_PATH) || readFileSync(INDEX_PATH, 'utf8') !== indexText)
      changes.push('archive-index.json');

    for (const line of fallbacks) warn(`vendor: fallback: ${line}`);
    const kinds = Object.values(icons).reduce(
      (counts, icon) => ({ ...counts, [icon.kind]: (counts[icon.kind] ?? 0) + 1 }),
      /** @type {Record<string, number>} */ ({}),
    );
    say(
      `vendor: ${String(outputs.size)} vendored files for ${String(Object.keys(icons).length)} keys ` +
        `(${Object.entries(kinds)
          .map(([kind, count]) => `${kind} ${String(count)}`)
          .join(
            ', ',
          )}); ${String(Object.values(mapping.icons).filter((entry) => entry.own !== undefined).length)} own drawings are not vendored`,
    );
    if (check) {
      if (changes.length === 0) {
        say('vendor: up to date.');
        return 0;
      }
      warn(`vendor: out of date:\n  ${changes.join('\n  ')}`);
      return 1;
    }
    mkdirSync(VENDORED_DIR, { recursive: true });
    for (const [file, content] of outputs) writeFileSync(path.join(VENDORED_DIR, file), content);
    for (const name of stale) unlinkSync(path.join(VENDORED_DIR, name));
    writeFileSync(MANIFEST_PATH, manifestText);
    writeFileSync(INDEX_PATH, indexText);
    say(
      changes.length === 0
        ? 'vendor: nothing changed.'
        : `vendor: wrote ${String(changes.length)} change(s):\n  ${changes.join('\n  ')}`,
    );
    say('Next: pnpm --filter @gcportrait/icons build (regenerates src/generated/icons.ts).');
    return 0;
  } catch (error) {
    warn(`vendor: FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    if (cli.values['keep-temp']) say(`vendor: unzipped sets kept in ${temp}`);
    else rmSync(temp, { recursive: true, force: true });
  }
}

process.exitCode = await main(process.argv.slice(2));
