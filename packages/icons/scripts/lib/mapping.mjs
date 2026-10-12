// SPDX-License-Identifier: MIT
// @ts-check
/**
 * `mapping.json`, the hand-maintained part of the icon data: which artwork each icon key gets. Loaded and
 * validated here for vendor.mjs, build.mjs and the tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_DIR } from './catalog-keys.mjs';

/** The model's icon-key pattern (`ICON_KEY_PATTERN` in @gcportrait/model), repeated for plain-JS tooling. */
export const ICON_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** The size guard: no icon file (vendored or own) above 8 kB. */
export const MAX_ICON_BYTES = 8192;

/** The three Google icon sets, in fallback order after an own drawing. */
export const SETS = /** @type {const} */ (['core', 'legacy', 'category']);

/**
 * @typedef {'core' | 'legacy' | 'category'} SetName
 * @typedef {{ title: string, url: string, viewBox: number }} SourceSet
 * @typedef {{ own?: string, core?: string, legacy?: string, category?: string, generic?: boolean }} MappingEntry
 * @typedef {{ subject: string, key: string, decision: 'official' | 'own', note: string }} LegibilityDecision
 * @typedef {object} Mapping
 * @property {string} description
 * @property {Record<SetName, SourceSet>} sources
 * @property {Record<string, string>} categories category key → entry name in the category set
 * @property {Record<string, MappingEntry>} icons icon key → candidate artwork
 * @property {LegibilityDecision[]} legibility16 the 16 px legibility check list (README) and its decisions
 * @property {Record<string, string>} [keepOlderSymbol] icon key → why it keeps its older symbol (a legacy
 *   console icon or a category mark) although a new-style icon on the page matches its name; the drift check
 *   then reports the match as kept instead of as drift (README "Keeping the icons current")
 */

export const MAPPING_PATH = path.join(PACKAGE_DIR, 'mapping.json');
export const OWN_DIR = path.join(PACKAGE_DIR, 'own');

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks the shape and the cross-references of a mapping document; returns the problems found.
 * @param {unknown} document
 * @param {string} [ownDir]
 * @returns {string[]}
 */
export function mappingProblems(document, ownDir = OWN_DIR) {
  /** @type {string[]} */
  const problems = [];
  if (!isRecord(document)) return ['mapping.json is not an object'];
  if (typeof document.description !== 'string' || document.description === '')
    problems.push('description missing');
  const { sources, categories, icons } = document;
  if (!isRecord(sources)) problems.push('sources missing');
  else {
    for (const set of SETS) {
      const source = sources[set];
      if (
        !isRecord(source) ||
        typeof source.title !== 'string' ||
        typeof source.url !== 'string' ||
        !source.url.startsWith('https://') ||
        (source.viewBox !== 24 && source.viewBox !== 512)
      ) {
        problems.push(`sources.${set} needs a title, an https url and a viewBox of 24 or 512`);
      }
    }
  }
  if (!isRecord(categories)) return [...problems, 'categories missing'];
  if (!isRecord(icons)) return [...problems, 'icons missing'];
  for (const [key, entry] of Object.entries(categories)) {
    if (!ICON_KEY.test(key) || !key.startsWith('category_'))
      problems.push(`category key ${key} is not category_<name>`);
    if (typeof entry !== 'string' || !entry.endsWith('.svg'))
      problems.push(`categories.${key} is not an SVG entry`);
    if (key in icons) problems.push(`${key} is both a category and an icon key`);
  }
  let generics = 0;
  for (const [key, entry] of Object.entries(icons)) {
    if (!ICON_KEY.test(key)) problems.push(`icon key ${key} does not match ${String(ICON_KEY)}`);
    if (key.startsWith('category_')) problems.push(`icon key ${key} uses the category_ prefix`);
    if (!isRecord(entry)) {
      problems.push(`icons.${key} is not an object`);
      continue;
    }
    for (const field of Object.keys(entry)) {
      if (!['own', 'core', 'legacy', 'category', 'generic'].includes(field))
        problems.push(`icons.${key}.${field} is unknown`);
    }
    for (const field of ['own', 'core', 'legacy']) {
      const value = entry[field];
      if (value !== undefined && (typeof value !== 'string' || !value.endsWith('.svg'))) {
        problems.push(`icons.${key}.${field} is not an SVG file name`);
      }
    }
    if (typeof entry.own === 'string' && !existsSync(path.join(ownDir, entry.own))) {
      problems.push(`icons.${key}.own: own/${entry.own} does not exist`);
    }
    if (
      entry.category !== undefined &&
      (typeof entry.category !== 'string' || !(entry.category in categories))
    ) {
      problems.push(`icons.${key}.category names no key of "categories"`);
    }
    if (
      entry.own === undefined &&
      entry.core === undefined &&
      entry.legacy === undefined &&
      entry.category === undefined
    ) {
      problems.push(`icons.${key} names no artwork`);
    }
    if (entry.generic !== undefined) {
      if (entry.generic !== true) problems.push(`icons.${key}.generic must be true when present`);
      generics += 1;
    }
  }
  if (generics !== 1)
    problems.push(`exactly one icon is the generic mark (generic: true); found ${String(generics)}`);
  const legibility = document.legibility16;
  if (!Array.isArray(legibility) || legibility.length === 0) problems.push('legibility16 missing');
  else {
    legibility.forEach((/** @type {unknown} */ row, index) => {
      if (
        !isRecord(row) ||
        typeof row.subject !== 'string' ||
        typeof row.key !== 'string' ||
        typeof row.note !== 'string' ||
        (row.decision !== 'official' && row.decision !== 'own')
      ) {
        problems.push(
          `legibility16[${String(index)}] needs subject, key, decision (official or own) and note`,
        );
        return;
      }
      const entry = icons[row.key];
      if (!isRecord(entry)) problems.push(`legibility16[${String(index)}]: ${row.key} is not an icon key`);
      else if ((row.decision === 'own') !== (entry.own !== undefined)) {
        problems.push(
          `legibility16[${String(index)}]: ${row.key} is decided "${row.decision}" but mapped otherwise`,
        );
      }
    });
  }
  const keep = document.keepOlderSymbol;
  if (keep !== undefined) {
    if (!isRecord(keep)) problems.push('keepOlderSymbol is not an object');
    else {
      for (const [key, reason] of Object.entries(keep)) {
        const entry = icons[key];
        if (!isRecord(entry)) problems.push(`keepOlderSymbol.${key} is not an icon key`);
        else if (entry.own !== undefined || entry.core !== undefined)
          problems.push(`keepOlderSymbol.${key}: the key already uses an own drawing or a core mark`);
        if (typeof reason !== 'string' || reason.trim() === '')
          problems.push(`keepOlderSymbol.${key} needs a reason`);
      }
    }
  }
  const used = new Set(Object.values(icons).map((entry) => (isRecord(entry) ? entry.category : undefined)));
  for (const key of Object.keys(categories))
    if (!used.has(key)) problems.push(`category ${key} is used by no icon`);
  return problems;
}

/**
 * Reads and validates `mapping.json`.
 * @param {string} [file]
 * @returns {Mapping}
 */
export function loadMapping(file = MAPPING_PATH) {
  /** @type {unknown} */
  const document = JSON.parse(readFileSync(file, 'utf8'));
  const problems = mappingProblems(document);
  if (problems.length > 0) throw new Error(`mapping.json is invalid:\n  ${problems.join('\n  ')}`);
  return /** @type {Mapping} */ (document);
}

/** @returns {string} the generic mark's key */
export function genericKey(/** @type {Mapping} */ mapping) {
  const entry = Object.entries(mapping.icons).find(([, value]) => value.generic === true);
  if (entry === undefined) throw new Error('mapping.json has no generic mark');
  return entry[0];
}
