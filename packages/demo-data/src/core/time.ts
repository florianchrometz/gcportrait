// SPDX-License-Identifier: MIT
/**
 * Calendar arithmetic and the timestamp formats the Google APIs use. All instants are milliseconds since the
 * epoch (UTC). `Date` is used only to format and parse given instants, never to read the clock.
 */
import { hash32 } from './hash.js';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const TICK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of a `YYYY-MM-DD` day. Throws on anything that is not a real calendar date. */
export function parseTick(tick: string): number {
  const match = TICK_PATTERN.exec(tick);
  if (match === null) throw new RangeError(`"${tick}" is not a YYYY-MM-DD date`);
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (formatTick(ms) !== tick) throw new RangeError(`"${tick}" is not a real calendar date`);
  return ms;
}

/** The UTC day of an instant as `YYYY-MM-DD`. */
export function formatTick(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Day of the week of an instant in UTC, 0 = Sunday. */
export function weekday(ms: number): number {
  return new Date(ms).getUTCDay();
}

/** `YYYY-MM-DDTHH:MM:SSZ`. */
export function rfc3339Seconds(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** `YYYY-MM-DDTHH:MM:SS.mmmZ`. */
export function rfc3339Millis(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * `YYYY-MM-DDTHH:MM:SS.ffffffZ`. The three sub-millisecond digits come from `salt` (usually the asset name),
 * so two assets stamped in the same millisecond still differ the way real CAI timestamps do.
 */
export function rfc3339Micros(ms: number, salt: string): string {
  const micros = String(hash32(salt) % 1000).padStart(3, '0');
  return `${new Date(ms).toISOString().slice(0, 23)}${micros}Z`;
}

/** Milliseconds since the epoch as a decimal string (BigQuery's `creationTime`). */
export function epochMillis(ms: number): string {
  return String(ms);
}

/**
 * Compute Engine's `creationTimestamp` form: US Pacific local time with its offset, e.g.
 * `2026-03-14T09:21:07.123-07:00` (daylight saving time from the second Sunday of March to the first Sunday of
 * November, switching at 02:00 local time).
 */
export function computeTimestamp(ms: number): string {
  const offsetHours = isPacificDaylightTime(ms) ? -7 : -8;
  const local = new Date(ms + offsetHours * HOUR_MS).toISOString().slice(0, 23);
  return `${local}-0${String(-offsetHours)}:00`;
}

function isPacificDaylightTime(ms: number): boolean {
  const year = new Date(ms).getUTCFullYear();
  const start = nthSundayUtc(year, 2, 2) + 10 * HOUR_MS; // 02:00 PST = 10:00 UTC
  const end = nthSundayUtc(year, 10, 1) + 9 * HOUR_MS; // 02:00 PDT = 09:00 UTC
  return ms >= start && ms < end;
}

function nthSundayUtc(year: number, month: number, nth: number): number {
  const first = Date.UTC(year, month, 1);
  const firstSunday = first + ((7 - new Date(first).getUTCDay()) % 7) * DAY_MS;
  return firstSunday + (nth - 1) * 7 * DAY_MS;
}
