// SPDX-License-Identifier: MIT
/**
 * Deterministic sibling order (skill gcp-diagram-layout §4): zones before cards; zones by kind rank (folder,
 * project, VPC, subnet, region, product container, bundle); then by label in code-point order
 * (locale-independent); then by id. Ids are unique, so the order is total and never depends on the order the
 * Scene lists its children in.
 */
import { ZONE_KIND_RANK, type ZoneKind } from '@gcportrait/model';

/**
 * Compares two strings by Unicode code point. JavaScript's `<` compares UTF-16 code units, which puts a
 * supplementary character (a surrogate pair, 0xD800–0xDFFF) before U+E000–U+FFFF; code-point order does not.
 */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    // Below the surrogates and above them, code units order like code points; only a surrogate meeting a
    // unit ≥ 0xE000 is out of order, and a surrogate (a supplementary code point) is the larger one.
    const xSurrogate = x >= 0xd800 && x <= 0xdfff;
    const ySurrogate = y >= 0xd800 && y <= 0xdfff;
    if (xSurrogate !== ySurrogate && Math.max(x, y) >= 0xe000) return xSurrogate ? 1 : -1;
    return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

export interface Orderable {
  readonly id: string;
  readonly type: 'zone' | 'card';
  readonly kind: ZoneKind | 'card';
  readonly label: string;
}

export function compareSiblings(a: Orderable, b: Orderable): number {
  if (a.type !== b.type) return a.type === 'zone' ? -1 : 1;
  if (a.kind !== 'card' && b.kind !== 'card') {
    const rank = ZONE_KIND_RANK[a.kind] - ZONE_KIND_RANK[b.kind];
    if (rank !== 0) return rank;
  }
  return compareCodePoints(a.label, b.label) || compareCodePoints(a.id, b.id);
}
