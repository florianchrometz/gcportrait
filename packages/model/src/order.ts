// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic orderings used across gcportrait (never locale-dependent).
 * Pure and Zod-free.
 */
import type { ZoneKind } from './schemas/scene.js';
import { ZONE_KIND_RANK } from './schemas/zone-order.js';

/** Code-unit order (UTF-16), locale-independent, the same everywhere. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Decimal strings in numeric order (no sign, no leading zeros: shorter is smaller). */
export function compareDecimal(a: string, b: string): number {
  return a.length - b.length || compareText(a, b);
}

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

const RFC3339 =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt ]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(?:([Zz])|([+-])([0-9]{2}):([0-9]{2}))$/;

interface Instant {
  /** Whole seconds since the epoch. */
  readonly seconds: number;
  /** The fractional digits, without trailing zeros. */
  readonly fraction: string;
}

function parseInstant(timestamp: string): Instant | undefined {
  const match = RFC3339.exec(timestamp);
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second, fraction = '', , sign, offsetHours, offsetMinutes] = match;
  const local = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const offset =
    sign === undefined
      ? 0
      : (sign === '-' ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60;
  return { seconds: local / 1000 - offset, fraction: fraction.replace(/0+$/, '') };
}

/**
 * Orders two timestamps by the instant they denote (negative, zero or positive). Text that is not an RFC 3339
 * timestamp sorts after every timestamp, and two such texts compare as strings, so the order stays total.
 */
export function compareTimestamps(a: string, b: string): number {
  const left = parseInstant(a);
  const right = parseInstant(b);
  if (left === undefined || right === undefined) {
    if (left !== undefined) return -1;
    if (right !== undefined) return 1;
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  const width = Math.max(left.fraction.length, right.fraction.length);
  const l = left.fraction.padEnd(width, '0');
  const r = right.fraction.padEnd(width, '0');
  if (l === r) return 0;
  return l < r ? -1 : 1;
}

export interface Orderable {
  readonly id: string;
  readonly type: 'zone' | 'card';
  readonly kind?: ZoneKind | 'card' | undefined;
  readonly label: string;
}

/**
 * Deterministic sibling order (skill gcp-diagram-layout §4): zones before cards; zones by kind rank
 * (folder, project, VPC, subnet, region, product container, group); then by label in code-point order;
 * then by id. Ids are unique, so the order is total and never depends on the input order.
 */
export function compareSiblings(a: Orderable, b: Orderable): number {
  if (a.type !== b.type) return a.type === 'zone' ? -1 : 1;
  if (a.kind !== undefined && a.kind !== 'card' && b.kind !== undefined && b.kind !== 'card') {
    const rank = ZONE_KIND_RANK[a.kind] - ZONE_KIND_RANK[b.kind];
    if (rank !== 0) return rank;
  }
  return compareCodePoints(a.label, b.label) || compareCodePoints(a.id, b.id);
}

/** A map's entries as a plain record with sorted keys (own properties only, `__proto__` included safely). */
export function sortedRecord<V>(
  map: ReadonlyMap<string, V>,
  compare: (left: string, right: string) => number = compareText,
): Record<string, V> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => compare(a, b)));
}
