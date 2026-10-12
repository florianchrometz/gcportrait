// SPDX-License-Identifier: MIT
/** Deterministic orderings used across the package (never locale-dependent). */

/** Code-unit order, the same everywhere. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Numeric order for decimal strings without sign or leading zeros (project numbers of any length). */
export function compareDecimal(left: string, right: string): number {
  return left.length - right.length || compareText(left, right);
}

/**
 * Chronological order of two RFC 3339 timestamps, offsets applied, down to the nanosecond: `…41.123456Z`
 * comes after `…41.123Z`. Timestamps that do not parse sort first.
 */
export function compareTimestamps(left: string, right: string): number {
  const millis = compareMillis(Date.parse(left), Date.parse(right));
  return millis !== 0 ? millis : compareText(subMillisecond(left), subMillisecond(right));
}

function compareMillis(left: number, right: number): number {
  const a = Number.isNaN(left) ? Number.NEGATIVE_INFINITY : left;
  const b = Number.isNaN(right) ? Number.NEGATIVE_INFINITY : right;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The fraction digits below a millisecond, padded to six (micro- and nanoseconds). */
function subMillisecond(timestamp: string): string {
  const fraction = /\.(\d+)/.exec(timestamp)?.[1] ?? '';
  return fraction.slice(3, 9).padEnd(6, '0');
}
