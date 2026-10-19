#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * The icon drift check: are the Google Cloud product icons the repository vendored still what Google Cloud
 * provides at https://cloud.google.com/icons? It reads that page, downloads the official archives it links into
 * a fresh temporary directory, lists their SVG entries with the safe reader of lib/zip.mjs (nothing from the
 * download is executed), and compares names and SHA-256 hashes with archive-index.json (every entry as last
 * vendored), mapping.json and manifest.json (lib/drift.mjs). The report lists new icons (with a guess of the
 * catalog product each belongs to, by name), changed, renamed and removed icons, entries the mapping uses that
 * are gone, products still drawn with an older symbol although a matching new-style icon exists, and which
 * products still use the older symbols. It never changes the repository: vendoring an update is
 * `pnpm --filter @gcportrait/icons vendor` (README "Keeping the icons current").
 *
 * Usage:
 *   node scripts/drift.mjs [--offline --zips <dir>] [--page <file>] [--markdown <file>] [--json <file>] [--keep-temp]
 *     --zips <dir>       read <dir>/<file name of each archive URL> instead of downloading the archives
 *     --offline          touch no network: the archives come from --zips (required), the page from --page if given
 *     --page <file>      read a saved copy of the library page instead of fetching it
 *     --markdown <file>  also write the report as Markdown (the weekly workflow's issue body and job summary)
 *     --json <file>      also write the report as JSON
 *     --keep-temp        keep the temporary directory (the downloaded archives and their SVG entries) and print
 *                        its path; `vendor --zips <that directory>` then vendors exactly those bytes
 * Exit codes: 0 no drift, 1 drift, 2 a usage error, 3 the check could not run (network, a corrupt archive).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { readArchiveIndex } from './lib/archive-index.mjs';
import {
  HttpStatusError,
  ICONS_PAGE,
  MAX_ARCHIVE_BYTES,
  MAX_PAGE_BYTES,
  archiveFileName,
  archiveLinksOf,
  download,
  inventoryOf,
  isDownloadableLink,
  sha256,
  svgEntries,
  writeEntries,
} from './lib/archives.mjs';
import { catalogProducts } from './lib/catalog-keys.mjs';
import { driftReport, formatMarkdown, formatText } from './lib/drift.mjs';
import { readManifest } from './lib/manifest.mjs';
import { SETS, loadMapping } from './lib/mapping.mjs';

/**
 * @typedef {import('./lib/mapping.mjs').SetName} SetName
 * @typedef {import('./lib/drift.mjs').FetchedArchive} FetchedArchive
 */

/** @param {string} line */
const say = (line) => process.stdout.write(`${line}\n`);
/** @param {string} line */
const warn = (line) => process.stderr.write(`${line}\n`);

/**
 * @param {readonly string[]} argv
 */
function parseCli(argv) {
  return parseArgs({
    args: [...argv],
    options: {
      offline: { type: 'boolean', default: false },
      zips: { type: 'string' },
      page: { type: 'string' },
      markdown: { type: 'string' },
      json: { type: 'string' },
      'keep-temp': { type: 'boolean', default: false },
    },
    strict: true,
  });
}

/**
 * Reads or downloads one archive into `temp`, then lists its SVG entries. HTTP 4xx and a file missing from
 * `--zips` make it unavailable (drift); anything else is a failure.
 * @param {string} url
 * @param {object} options
 * @param {string | undefined} options.zips
 * @param {boolean} options.offline
 * @param {string} options.temp
 * @param {string} options.label the sub-directory its entries are written to with --keep-temp
 * @param {boolean} options.keep
 * @returns {Promise<FetchedArchive>}
 */
async function fetchOne(url, { zips, offline, temp, label, keep }) {
  /** @type {Buffer} */
  let archive;
  if (zips !== undefined) {
    const file = path.join(zips, archiveFileName(url));
    say(`  reading ${file}`);
    try {
      archive = readFileSync(file);
    } catch {
      return { url, available: false, reason: `${archiveFileName(url)} is not in ${zips}` };
    }
  } else if (offline) {
    return { url, available: false, reason: 'offline' };
  } else {
    say(`  downloading ${url}`);
    try {
      archive = await download(url, MAX_ARCHIVE_BYTES);
    } catch (error) {
      if (error instanceof HttpStatusError && error.status >= 400 && error.status < 500)
        return { url, available: false, reason: error.message };
      throw error;
    }
  }
  writeFileSync(path.join(temp, archiveFileName(url)), archive);
  const entries = svgEntries(archive);
  if (keep) writeEntries(entries, path.join(temp, label));
  return {
    url,
    available: true,
    bytes: archive.length,
    sha256: sha256(archive),
    entries: inventoryOf(entries),
  };
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
    warn(`drift: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const { offline, zips, page: pageFile, markdown, json } = cli.values;
  const keep = cli.values['keep-temp'];
  if (offline && zips === undefined) {
    warn('drift: --offline needs --zips <dir> with the archives');
    return 2;
  }

  /** @type {string | undefined} */
  let temp;
  try {
    const mapping = loadMapping();
    const manifest = readManifest();
    if (manifest === undefined) throw new Error('manifest.json is missing; run scripts/vendor.mjs');
    const index = readArchiveIndex();
    if (index === undefined)
      warn('drift: archive-index.json is missing; every entry counts as new (run vendor)');
    temp = mkdtempSync(path.join(tmpdir(), 'gcportrait-icon-drift-'));

    /** @type {{ url: string, links: string[] } | undefined} */
    let page;
    if (pageFile !== undefined) {
      say(`drift: reading the library page from ${pageFile}`);
      page = { url: ICONS_PAGE, links: archiveLinksOf(readFileSync(pageFile, 'utf8')) };
    } else if (!offline) {
      say(`drift: reading ${ICONS_PAGE}`);
      const html = (await download(ICONS_PAGE, MAX_PAGE_BYTES)).toString('utf8');
      page = { url: ICONS_PAGE, links: archiveLinksOf(html) };
      if (page.links.length === 0)
        throw new Error(
          `${ICONS_PAGE} links no ZIP archive; the page layout may have changed (check it by hand)`,
        );
    }

    say('drift: archives');
    /** @type {Partial<Record<SetName, FetchedArchive>>} */
    const current = {};
    for (const set of SETS) {
      current[set] = await fetchOne(mapping.sources[set].url, { zips, offline, temp, label: set, keep });
    }
    const mapped = new Set(SETS.map((set) => mapping.sources[set].url));
    /** @type {FetchedArchive[]} */
    const extra = [];
    for (const [i, url] of (page?.links ?? []).filter((link) => !mapped.has(link)).entries()) {
      if (!isDownloadableLink(url)) {
        extra.push({ url, available: false, reason: 'not on a Google host; not downloaded' });
        continue;
      }
      extra.push(await fetchOne(url, { zips, offline, temp, label: `extra-${String(i + 1)}`, keep }));
    }

    const report = driftReport({
      mapping,
      manifest,
      index,
      products: catalogProducts(),
      page,
      current,
      extra,
    });
    for (const line of formatText(report)) say(line);
    if (markdown !== undefined) {
      mkdirSync(path.dirname(path.resolve(markdown)), { recursive: true });
      writeFileSync(markdown, formatMarkdown(report));
    }
    if (json !== undefined) {
      mkdirSync(path.dirname(path.resolve(json)), { recursive: true });
      writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
    }
    return report.drift ? 1 : 0;
  } catch (error) {
    warn(`drift: FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return 3;
  } finally {
    if (temp !== undefined) {
      if (keep) say(`drift: downloads kept in ${temp}`);
      else rmSync(temp, { recursive: true, force: true });
    }
  }
}

process.exitCode = await main(process.argv.slice(2));
