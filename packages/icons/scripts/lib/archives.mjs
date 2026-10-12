// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Getting Google Cloud's official icon archives, shared by vendor.mjs and drift.mjs: the library page that
 * links them (https://cloud.google.com/icons), downloading with a size cap, reading a saved copy from a
 * directory, listing an archive's SVG entries through the safe reader of zip.mjs, and the inventory (entry
 * name → SHA-256) that `archive-index.json` records and the drift check compares.
 *
 * Everything downloaded is untrusted data: it is held in memory or written as plain files below a fresh
 * temporary directory, parsed only by zip.mjs (bounded entry sizes, no unsafe paths), and nothing in it is
 * ever executed or interpreted beyond reading SVG bytes.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isSafeEntryName, readZip } from './zip.mjs';

/** Google Cloud's icon library page, which links the archives (and the product icons overview). */
export const ICONS_PAGE = 'https://cloud.google.com/icons';

/** Download caps: the page and each archive (the largest archive was 2.3 MB on 2026-10-11). */
export const MAX_PAGE_BYTES = 16 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

/** How long one request may take before it counts as failed. */
const TIMEOUT_MS = 120_000;

/**
 * An HTTP answer other than 2xx, kept apart from network failures: a 404 for an archive is drift (it was
 * removed or moved), a timeout is not.
 */
export class HttpStatusError extends Error {
  /**
   * @param {string} url
   * @param {number} status
   * @param {string} statusText
   */
  constructor(url, status, statusText) {
    super(`GET ${url} answered HTTP ${String(status)} ${statusText}`.trim());
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

/**
 * @param {Buffer | string} data
 * @returns {string}
 */
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * The file name a downloaded archive is saved under (and looked up by in a `--zips` directory).
 * @param {string} url
 * @returns {string}
 */
export const archiveFileName = (url) => path.posix.basename(new URL(url).pathname);

/**
 * Downloads `url` (https only) into memory, refusing more than `maxBytes`.
 * @param {string} url
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
export async function download(url, maxBytes) {
  if (new URL(url).protocol !== 'https:') throw new Error(`refusing to download a non-https URL: ${url}`);
  /** @type {Response} */
  let response;
  try {
    response = await globalThis.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  if (!response.ok) throw new HttpStatusError(url, response.status, response.statusText);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes)
    throw new Error(`GET ${url}: ${String(declared)} bytes, above the ${String(maxBytes)}-byte cap`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > maxBytes)
    throw new Error(`GET ${url}: ${String(body.length)} bytes, above the ${String(maxBytes)}-byte cap`);
  return body;
}

/**
 * An archive named by its URL: read from `<zipsDir>/<file name>` when a directory is given, else downloaded.
 * @param {string} url
 * @param {string | undefined} zipsDir
 * @param {(line: string) => void} [log]
 * @returns {Promise<Buffer>}
 */
export async function fetchArchive(url, zipsDir, log = () => undefined) {
  if (zipsDir !== undefined) {
    const file = path.join(zipsDir, archiveFileName(url));
    log(`  reading ${file}`);
    return readFileSync(file);
  }
  log(`  downloading ${url}`);
  return download(url, MAX_ARCHIVE_BYTES);
}

/**
 * @typedef {object} SvgEntry
 * @property {string} name the entry's path inside the archive
 * @property {Buffer} data its bytes
 */

/**
 * The SVG entries of an archive, sorted by name: no directories, no other file types, no macOS resource forks
 * (`__MACOSX/`, `._*`). An entry name that could escape a directory stops the read.
 * @param {Buffer} archive
 * @returns {SvgEntry[]}
 */
export function svgEntries(archive) {
  /** @type {SvgEntry[]} */
  const entries = [];
  for (const entry of readZip(archive)) {
    const base = path.posix.basename(entry.name);
    if (entry.directory || !base.toLowerCase().endsWith('.svg')) continue;
    if (base.startsWith('._') || entry.name.startsWith('__MACOSX/')) continue;
    if (!isSafeEntryName(entry.name)) throw new Error(`unsafe entry name in archive: ${entry.name}`);
    entries.push({ name: entry.name, data: entry.read() });
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Entry name → SHA-256 of every SVG entry, in name order.
 * @param {readonly SvgEntry[]} entries
 * @returns {Record<string, string>}
 */
export function inventoryOf(entries) {
  return Object.fromEntries(entries.map((entry) => [entry.name, sha256(entry.data)]));
}

/**
 * Writes SVG entries below `directory` (the entry names were checked by `svgEntries`); returns their names.
 * @param {readonly SvgEntry[]} entries
 * @param {string} directory
 * @returns {string[]}
 */
export function writeEntries(entries, directory) {
  for (const entry of entries) {
    const target = path.join(directory, ...entry.name.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
  }
  return entries.map((entry) => entry.name);
}

/**
 * The ZIP archive links of the library page: every absolute https URL ending in `.zip`, JSON-escaped slashes
 * included, without duplicates, sorted. The page is read as text only.
 * @param {string} html
 * @returns {string[]}
 */
export function archiveLinksOf(html) {
  const text = html.replaceAll('\\/', '/').replaceAll(/\\u002[fF]/g, '/');
  /** @type {Set<string>} */
  const links = new Set();
  for (const match of text.matchAll(/https:\/\/[A-Za-z0-9.-]+\/[^\s"'<>()\\]*?\.zip(?![A-Za-z0-9])/g)) {
    try {
      const url = new URL(match[0]);
      url.hash = '';
      links.add(url.href);
    } catch {
      // Not a URL after all; ignore it.
    }
  }
  return [...links].sort();
}

/**
 * Whether a link found on the page may be downloaded by the drift check: https on a Google host.
 * @param {string} url
 * @returns {boolean}
 */
export function isDownloadableLink(url) {
  const { protocol, hostname } = new URL(url);
  return (
    protocol === 'https:' &&
    (hostname === 'google.com' || hostname.endsWith('.google.com') || hostname.endsWith('.gstatic.com'))
  );
}
