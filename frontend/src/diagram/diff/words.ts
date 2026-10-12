// SPDX-License-Identifier: MIT
/**
 * The timeline markers' words: the legend's rows, the accessible names' additions, the ghosts' tooltips and
 * the drawing's description, all naming the day compared with as the title block names a read time (ISO-8601 at
 * the viewer's UTC offset, the date of which is the local date the timeline bar labels that day with): "since
 * 2026-09-07" when that day is earlier, "compared with 2026-10-08" when the view stepped back from a later one.
 */
import { formatReadTime } from '../titleBlock';
import type { DiffCounts, DiffDay, GhostReason } from './types';

/** What a marker stands for, as the legend and the names say it. */
export type MarkerKind = 'added' | 'removed' | 'changed';

function instant(readTime: string): number {
  const value = Date.parse(readTime);
  return Number.isNaN(value) ? 0 : value;
}

/** Whether the day compared with is not later than the drawn day (read at `readTime`): "since", else "compared with". */
export function comparesForward(day: Pick<DiffDay, 'readTime'>, readTime: string): boolean {
  return instant(day.readTime) <= instant(readTime);
}

/** The day compared with: its date at the viewer's offset (`2026-09-07`). */
export function dayLabel(day: Pick<DiffDay, 'readTime'>, utcOffsetMinutes: number): string {
  return formatReadTime(day.readTime, utcOffsetMinutes).slice(0, 10);
}

/** The day compared with as the wording names it: an extra tick by its label, a day by its date. */
export function dayName(day: Pick<DiffDay, 'readTime' | 'label'>, utcOffsetMinutes: number): string {
  return day.label ?? dayLabel(day, utcOffsetMinutes);
}

/**
 * "since 2026-09-07" (the day compared with is earlier) or "compared with 2026-10-08" (it is later); an extra tick by
 * its label, "since export 2026-10-05 14:30", so it is not read as the day 5 October.
 */
export function sincePhrase(
  day: Pick<DiffDay, 'readTime' | 'label'>,
  forward: boolean,
  utcOffsetMinutes: number,
): string {
  return `${forward ? 'since' : 'compared with'} ${dayName(day, utcOffsetMinutes)}`;
}

/** A legend row: "added since 2026-09-07". */
export function markerLabel(kind: MarkerKind, since: string): string {
  return `${kind} ${since}`;
}

/** "2 added, 1 removed, 3 changed" (kinds with none left out; "no changes" for none). */
export function countsText(counts: DiffCounts): string {
  const parts = (['added', 'removed', 'changed'] as const).flatMap((kind) =>
    counts[kind] > 0 ? [`${String(counts[kind])} ${kind}`] : [],
  );
  return parts.length === 0 ? 'no changes' : parts.join(', ');
}

/** What a node's accessible name adds: ", added since …", ", changed since …", or what changed inside a chip. */
export function nameSuffix(
  status: 'added' | 'changed' | undefined,
  inside: DiffCounts | undefined,
  since: string,
): string {
  const own = status === undefined ? '' : `, ${status} ${since}`;
  const held = inside === undefined ? '' : `, changes inside ${since}: ${countsText(inside)}`;
  return `${own}${held}`;
}

/** A ghost's tooltip and accessible name: "Removed since 2026-09-07: Cloud Storage bucket: scratch-1". */
export function ghostText(reason: GhostReason, name: string, since: string): string {
  return reason === 'removed' ? `Removed ${since}: ${name}` : `No longer in this view ${since}: ${name}`;
}

/** The line a ghost card shows under its label. */
export const GHOST_LINE: Readonly<Record<GhostReason, string>> = {
  removed: 'removed',
  hidden: 'not drawn now',
};

/** The drawing's description adds: "Changes since 2026-09-07: 1 added, 1 removed, 1 changed." */
export function descriptionText(totals: DiffCounts, since: string): string {
  return `Changes ${since}: ${countsText(totals)}.`;
}
