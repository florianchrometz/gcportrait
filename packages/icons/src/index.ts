// SPDX-License-Identifier: Apache-2.0
/**
 * @gcportrait/icons — the Google Cloud product icons as Google Cloud provides them at
 * https://cloud.google.com/icons, vendored unmodified, plus gcportrait's own drawings, keyed by the icon keys the
 * asset catalog uses (README.md). Pure data and lookups: no DOM, no Node APIs, safe in the app, its workers and
 * the headless renderer. This file is the package's only public surface.
 *
 * The Google Cloud product icons are Google Cloud's trademarks, used under Google's icon usage terms; see
 * README.md ("Trademark, usage terms and copyright") and AGENTS.md ("Non-affiliation, brand and legal").
 */
import { ARTWORK, GENERIC_KEY, RECORDS } from './generated/icons.js';
import type { Icon } from './types.js';

export type { Icon, IconKind, IconSet } from './types.js';

/** Every icon key this package resolves, sorted: the catalog's keys, the category marks, the generic marks. */
export const ICON_KEYS: readonly string[] = Object.freeze(Object.keys(RECORDS).sort());

/**
 * The key of the last-resort mark, Google's generic cloud icon. It is the same key `@gcportrait/graph` gives a
 * card whose type and service the catalog does not know (`GENERIC_ICON`).
 */
export const GENERIC_ICON_KEY: string = GENERIC_KEY;

const cache = new Map<string, Icon>();

/**
 * The icon of a key, or undefined for a key this package does not know. The result is frozen and shared.
 */
export function iconFor(key: string): Icon | undefined {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (!Object.hasOwn(RECORDS, key)) return undefined;
  const record = RECORDS[key];
  const svg = record === undefined ? undefined : ARTWORK[record.art];
  if (record === undefined || svg === undefined) return undefined;
  const icon: Icon = Object.freeze({
    key,
    svg,
    viewBox: record.viewBox,
    kind: record.kind,
    set: record.set,
    plateOnDark: record.plateOnDark,
    category: record.category,
  });
  cache.set(key, icon);
  return icon;
}

/** The generic cloud mark (always present; a test guarantees it). */
function genericIcon(): Icon {
  const icon = iconFor(GENERIC_ICON_KEY);
  if (icon === undefined) throw new Error(`icon table has no generic mark ${GENERIC_ICON_KEY}`);
  return icon;
}

/**
 * The icon for an asset, following the fallback chain (the package README, "Selection"): the type's own icon
 * key, then the product's (within one key the vendoring already preferred the marquee colour mark over the
 * two-tone console icon), then the category mark (`categoryKey`, or the category the mapping gives the type's
 * or the product's key), then the generic cloud mark. Never fails: an unknown or missing key falls through.
 */
export function resolveIcon(productKey?: string, typeKey?: string, categoryKey?: string): Icon {
  for (const key of [typeKey, productKey]) {
    const icon = key === undefined ? undefined : iconFor(key);
    if (icon !== undefined) return icon;
  }
  const categories = [
    categoryKey,
    typeKey === undefined ? undefined : categoryOf(typeKey),
    productKey === undefined ? undefined : categoryOf(productKey),
  ];
  for (const key of categories) {
    const icon = key === undefined ? undefined : iconFor(key);
    if (icon !== undefined) return icon;
  }
  return genericIcon();
}

/** Whether the key's artwork is one of gcportrait's own drawings rather than Google's. */
export function isOwnDrawing(key: string): boolean {
  return iconFor(key)?.kind === 'own';
}

/** The category mark key the mapping gives an icon key, if any. */
export function categoryOf(key: string): string | undefined {
  return iconFor(key)?.category;
}

/**
 * The icon as a nested `<svg>` element placed at (`x`, `y`) with a `size` × `size` box, for inlining into a
 * diagram's SVG. Only position and size are added; the artwork is untouched.
 */
export function placeIcon(icon: Icon, size: number, x = 0, y = 0): string {
  const placement = ` x="${String(x)}" y="${String(y)}" width="${String(size)}" height="${String(size)}"`;
  return icon.svg.replace(/^<svg\b/, `<svg${placement}`);
}
