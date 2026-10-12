// SPDX-License-Identifier: MIT
/**
 * RFC 3339 timestamps compared as instants. Cloud Asset Inventory writes `updateTime` with microseconds and a
 * `Z`, but other sources may use another precision or an offset; `2026-10-07T18:22:41.5Z` and
 * `2026-10-07T20:22:41.500+02:00` are the same instant and must not count as a change. Pure: `Date.UTC` only
 * does calendar arithmetic, no clock is read.
 */

const RFC3339 =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt ]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(?:([Zz])|([+-])([0-9]{2}):([0-9]{2}))$/;

interface Instant {
  /** Whole seconds since the epoch. */
  readonly seconds: number;
  /** The fractional digits, without trailing zeros. */
  readonly fraction: string;
}

function parse(timestamp: string): Instant | undefined {
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
  const left = parse(a);
  const right = parse(b);
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
