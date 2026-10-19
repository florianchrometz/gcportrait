// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * Compiles mapping.json, manifest.json, vendored/*.svg and own/*.svg into the TypeScript module
 * src/generated/icons.ts that the library exposes. Each distinct artwork is written once (ARTWORK); every key
 * points at its artwork (RECORDS), so the app bundle never carries an icon twice. Used by build.mjs and by the
 * staleness test.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PACKAGE_DIR } from './catalog-keys.mjs';
import { isTwoToneBlue } from './colour.mjs';
import { formatFile } from './format.mjs';
import { VENDORED_DIR, loadManifest } from './manifest.mjs';
import { OWN_DIR, genericKey, loadMapping } from './mapping.mjs';
import { coloursOf, transformIcon } from './svg.mjs';

export const MODULE_PATH = path.join(PACKAGE_DIR, 'src', 'generated', 'icons.ts');

/**
 * @typedef {import('./mapping.mjs').SetName | 'own'} IconSet
 * @typedef {'official' | 'own' | 'category' | 'generic'} IconKind
 * @typedef {object} IconEntry
 * @property {string} key
 * @property {string} svg
 * @property {string} viewBox
 * @property {IconKind} kind
 * @property {IconSet} set
 * @property {boolean} plateOnDark
 * @property {string | undefined} category
 * @property {string} file the file the artwork comes from, relative to the package
 */

/**
 * Whether an icon needs the light plate on dark canvases (style skill §2): Google's colour and grey marks do,
 * the two-tone blue console icons and the own drawings in the same palette do not.
 * @param {IconSet} set
 * @param {readonly string[]} colours
 * @returns {boolean}
 */
export function needsPlate(set, colours) {
  if (set === 'core' || set === 'category') return true;
  return !colours.every(isTwoToneBlue);
}

/**
 * Every icon key with its artwork and attributes, sorted by key.
 * @returns {IconEntry[]}
 */
export function collectIcons() {
  const mapping = loadMapping();
  const generic = genericKey(mapping);
  const manifest = loadManifest();
  /** @type {IconEntry[]} */
  const entries = [];
  for (const [key, icon] of Object.entries(manifest.icons)) {
    const file = manifest.files[icon.file];
    if (file === undefined)
      throw new Error(`manifest.json: ${key} points at ${icon.file}, which "files" does not list`);
    const svg = readFileSync(path.join(VENDORED_DIR, icon.file), 'utf8').trimEnd();
    const category = mapping.icons[key]?.category;
    entries.push({
      key,
      svg,
      viewBox: file.viewBox,
      kind: key === generic ? 'generic' : icon.kind,
      set: file.set,
      plateOnDark: needsPlate(file.set, file.colours),
      category,
      file: `vendored/${icon.file}`,
    });
  }
  for (const [key, entry] of Object.entries(mapping.icons)) {
    if (entry.own === undefined) continue;
    if (key in manifest.icons)
      throw new Error(`${key} is both an own drawing and vendored; run scripts/vendor.mjs`);
    const source = readFileSync(path.join(OWN_DIR, entry.own), 'utf8');
    const { svg, viewBox } = transformIcon(source, {
      idPrefix: `icon-${key.replaceAll('_', '-')}`,
      viewBoxSize: 24,
    });
    entries.push({
      key,
      svg,
      viewBox,
      kind: 'own',
      set: 'own',
      plateOnDark: needsPlate('own', coloursOf(svg)),
      category: entry.category,
      file: `own/${entry.own}`,
    });
  }
  for (const key of Object.keys(mapping.icons)) {
    if (!entries.some((entry) => entry.key === key))
      throw new Error(`${key} has no artwork; run scripts/vendor.mjs`);
  }
  return entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The `license` field of the repository's root package.json: the SPDX identifier every source file carries,
 * the generated module included (scripts/set-license.mjs rewrites both together).
 * @returns {string}
 */
export function repositoryLicense() {
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(path.join(PACKAGE_DIR, '..', '..', 'package.json'), 'utf8'));
  const license =
    typeof manifest === 'object' && manifest !== null && 'license' in manifest ? manifest.license : undefined;
  if (typeof license !== 'string' || license.trim() === '') {
    throw new Error('the root package.json has no license field');
  }
  return license.trim();
}

/**
 * The text of src/generated/icons.ts, formatted with the repository's Prettier settings.
 * @returns {Promise<string>}
 */
export async function renderIconModule() {
  const mapping = loadMapping();
  const entries = collectIcons();
  /** @type {string[]} */
  const artwork = [];
  /** @type {Map<string, number>} */
  const artIndex = new Map();
  const records = entries.map((entry) => {
    let index = artIndex.get(entry.svg);
    if (index === undefined) {
      index = artwork.length;
      artwork.push(entry.svg);
      artIndex.set(entry.svg, index);
    }
    const fields = [
      `art: ${String(index)}`,
      `kind: '${entry.kind}'`,
      `set: '${entry.set}'`,
      `viewBox: '${entry.viewBox}'`,
      `plateOnDark: ${String(entry.plateOnDark)}`,
      ...(entry.category === undefined ? [] : [`category: '${entry.category}'`]),
    ];
    return `  ${entry.key}: { ${fields.join(', ')} },`;
  });
  const license = repositoryLicense();
  const text = [
    `// SPDX-License-Identifier: ${license}`,
    '// Generated by scripts/build.mjs from mapping.json, manifest.json, vendored/ and own/: do not edit by hand.',
    '// Regenerate with `pnpm --filter @gcportrait/icons build`; a test fails while this file is stale. The',
    "// vendored artwork is Google Cloud's, as provided at https://cloud.google.com/icons, unmodified apart from the",
    "// mechanical transforms listed in README.md. The SPDX line covers this module's code and the own/ drawings",
    "// only: Google Cloud's artwork strings are used as provided under the terms stated on that page, are not",
    `// covered by ${license}, and are not licensed by gcportrait or its maintainer (THIRD_PARTY.md, README.md).`,
    "import type { IconRecord } from '../types.js';",
    '',
    '/** Every distinct artwork once; RECORDS point into it. */',
    'export const ARTWORK: readonly string[] = [',
    ...artwork.map((svg) => `  ${JSON.stringify(svg)},`),
    '];',
    '',
    '/** Every icon key, sorted. */',
    'export const RECORDS: Readonly<Record<string, IconRecord>> = {',
    ...records,
    '};',
    '',
    '/** The key of the last-resort mark (the generic cloud mark). */',
    `export const GENERIC_KEY = '${genericKey(mapping)}';`,
    '',
  ].join('\n');
  return formatFile(MODULE_PATH, text);
}
