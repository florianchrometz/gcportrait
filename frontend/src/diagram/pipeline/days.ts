// SPDX-License-Identifier: Apache-2.0
/**
 * How a request to the data worker names a day of a snapshot (protocol.ts): `{ tick }`, a timeline tick (a day
 * `YYYY-MM-DD` or an extra tick's read time) or `null` for the snapshot's own day. A Scene request's `diffFrom`,
 * a `changes` request's two days and every follow-up request's `day` (the day on screen) are read here, in the
 * worker.
 */
import type { DiffFrom } from '../diff/types';

/** The longest tick a request may name (a day is 10 characters, an extra tick's read time 20). */
const MAX_TICK_LENGTH = 64;

/** A day as a request names it: `undefined` when absent, `'invalid'` when malformed. */
export function parseDay(value: unknown): DiffFrom | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return 'invalid';
  const tick = (value as Record<string, unknown>)['tick'];
  if (tick === null) return { tick: null };
  return typeof tick === 'string' && tick !== '' && tick.length <= MAX_TICK_LENGTH ? { tick } : 'invalid';
}

/** A follow-up request's day: absent, the snapshot's own day; null when malformed. */
export function parseFollowUpDay(value: unknown): DiffFrom | null {
  const day = parseDay(value);
  if (day === 'invalid') return null;
  return day ?? { tick: null };
}
