// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * `manifest.json`, written by vendor.mjs: the record of what was vendored from Google's icon sets, from where,
 * when, and with which hashes before and after the mechanical transforms.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PACKAGE_DIR } from './catalog-keys.mjs';

export const MANIFEST_PATH = path.join(PACKAGE_DIR, 'manifest.json');
export const VENDORED_DIR = path.join(PACKAGE_DIR, 'vendored');

/**
 * @typedef {import('./mapping.mjs').SetName} SetName
 * @typedef {{ url: string, bytes: number, sha256: string, date: string }} ManifestSource
 * @typedef {object} ManifestFile
 * @property {SetName} set
 * @property {string} source the entry name inside the set's ZIP file
 * @property {string} viewBox
 * @property {{ bytes: number, sha256: string }} raw the file as Google ships it
 * @property {{ bytes: number, sha256: string }} vendored the file after the mechanical transforms
 * @property {string[]} colours every colour value in the vendored file, lower-cased and sorted
 * @property {string} date the date this exact file was vendored (YYYY-MM-DD)
 * @typedef {{ file: string, kind: 'official' | 'category' | 'generic' }} ManifestIcon
 * @typedef {object} Manifest
 * @property {string} description
 * @property {Record<SetName, ManifestSource>} sources
 * @property {Record<string, ManifestFile>} files
 * @property {Record<string, ManifestIcon>} icons
 */

/**
 * @param {string} [file]
 * @returns {Manifest | undefined}
 */
export function readManifest(file = MANIFEST_PATH) {
  if (!existsSync(file)) return undefined;
  /** @type {unknown} */
  const document = JSON.parse(readFileSync(file, 'utf8'));
  return /** @type {Manifest} */ (document);
}

/**
 * @param {string} [file]
 * @returns {Manifest}
 */
export function loadManifest(file = MANIFEST_PATH) {
  const manifest = readManifest(file);
  if (manifest === undefined) throw new Error('manifest.json is missing; run scripts/vendor.mjs');
  return manifest;
}
