// SPDX-License-Identifier: MIT
/**
 * The key a fetched tick is cached under in IndexedDB (storage/tickCache.ts): `(scope, readTime, contentType,
 * assetTypes?)`, as skill cai-ingestion §5 binds it. Two reads share an entry only when all four agree, so a tick is
 * never reused across scopes, read times, content types or type filters. The key is the JSON text of the four parts
 * (no separator can make two different keys alike); the type patterns are a set, so their order and repeats do not
 * matter, and none (or an empty list) means every type, as `assets.list` reads it.
 */

/** The only content type gcportrait reads (skill cai-ingestion §1). */
export const TICK_CONTENT_TYPE = 'RESOURCE';

export interface TickCacheKeyParts {
  /** The scope as Cloud Asset Inventory names it: `organizations/123`, `folders/456`, `projects/my-project`. */
  readonly scope: string;
  /** The tick's read time, `YYYY-MM-DDT00:00:00Z` (the latest tick too: its record says it was read at "now"). */
  readonly readTime: string;
  readonly contentType: string;
  /** RE2 patterns the read was limited to; absent or empty: every type. */
  readonly assetTypes?: readonly string[] | undefined;
}

/** The type filter as one canonical string: `*` for every type, else the distinct patterns sorted. */
export function assetTypesPart(assetTypes: readonly string[] | undefined): string {
  if (assetTypes === undefined || assetTypes.length === 0) return '*';
  return JSON.stringify([...new Set(assetTypes)].sort());
}

/** The cache key of a tick read. */
export function tickCacheKey(parts: TickCacheKeyParts): string {
  return JSON.stringify([parts.scope, parts.readTime, parts.contentType, assetTypesPart(parts.assetTypes)]);
}
