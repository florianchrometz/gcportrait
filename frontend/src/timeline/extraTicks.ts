// SPDX-License-Identifier: MIT
/**
 * Extra ticks (docs/timeline.md): the exports (a file or a `gs://` object) and the manual API pulls of a scope
 * that are stored in this browser appear on the timeline of every other snapshot of that scope, beside its daily
 * ticks, selectable like them, and played through only when the person asks for it.
 *
 * - **What is one.** A stored snapshot whose source is `export` or `api` and whose scope is the timeline's (same
 *   kind and id). Demo organisations and bundles that carry a history are timelines of their own, not extra ticks.
 * - **Its id** is its read time to the second in UTC, `2026-10-05T14:30:00Z` (`extraTickId`): what the view's `tick`
 *   names in the URL hash (the model's `TickSchema`), so a link names it the same way in every browser that holds
 *   that export, and never collides with a day tick (`2026-10-05`).
 * - **Duplicates.** Snapshots of the scope read in the same second are one tick (the same export imported twice, a
 *   pull and an export of the same moment), shown by the copy stored last (`copies` counts them; the data worker
 *   draws the same copy, `pickExtra`). The open snapshot itself is never one of its own extra ticks, and nor is a
 *   copy read at its own read time: it is on the timeline already. An extra tick read exactly at a day's 00:00 UTC
 *   stays a tick of its own after that day's (they differ in what they show: a replayed or re-read day, an import).
 * - **Ordering.** Every tick sits at the instant it shows (`at`): day ticks at their day's start (the latest live one
 *   at "now"), extra ticks at their read time; ties put the day first. A read time later than `now` (a clock that ran
 *   ahead, a typed-in time) is clamped to `now` and says so (`future`, `warning`): never a tick in the future.
 *
 * Pure but for `bindExtraTicks`, the store binding the snapshot library runs (snapshots/SnapshotLibraryProvider.tsx):
 * it writes the extra ticks of the view's timeline into the `timeline` slice whenever the timeline or the stored
 * snapshots change, so the timeline learns of them through the store only. `now` comes from the caller.
 */
import { isSnapshotRef, type SnapshotRef } from '@gcportrait/model';

import { formatUtc } from '../snapshots/labels';
import type { AppStore } from '../state';
import type { SnapshotMeta } from '../storage/db';
import type { TimelineSlice } from './state';
import { dayReadTime, localMinute, type LabelOptions, type TimelineTick } from './ticks';
import { scopePathOf, type TimelineInfo } from './types';

export { localMinute } from './ticks';

/** Where an extra tick's snapshot came from: an export (file or Cloud Storage) or a manual API pull. */
export type ExtraSource = 'export' | 'api';

/** Where an extra tick's read time came from, as the timeline says it. */
export type ExtraReadTimeSource = 'export-sidecar' | 'user' | 'api' | 'estimated' | 'unknown';

/** What the extra ticks are worked out from: a stored snapshot's id and listing metadata (never its blobs). */
export interface ExtraCandidate {
  readonly id: string;
  readonly meta: Pick<
    SnapshotMeta,
    | 'scope'
    | 'readTime'
    | 'source'
    | 'savedAt'
    | 'assetCount'
    | 'bytes'
    | 'detail'
    | 'estimatedReadTime'
    | 'readTimeSource'
  >;
}

export interface ExtraTick {
  /** The tick's id, what the view's `tick` names: the read time to the second in UTC, `2026-10-05T14:30:00Z`. */
  readonly id: string;
  /** The stored snapshot it shows: of its copies (`copies`), the one stored last. */
  readonly ref: SnapshotRef;
  readonly source: ExtraSource;
  /** The read time as the snapshot has it. */
  readonly readTime: string;
  readonly readTimeSource: ExtraReadTimeSource;
  /** Where it sits on the timeline, in milliseconds since the epoch: its read time, or `now` when that is later. */
  readonly at: number;
  /** Its read time is later than `now`, so it sits at `now` (`warning` says so). */
  readonly future: boolean;
  readonly warning?: string;
  /** How many stored snapshots of the scope were read in this second (the same export imported twice: 2). */
  readonly copies: number;
  readonly assetCount: number;
  /** What the shown copy takes in this browser. */
  readonly bytes: number;
  /** Its source detail (the file names, the `gs://` URI, "live pull"). */
  readonly detail?: string;
}

/** A day tick, or an extra tick (`extra`): the timeline's ticks in time order (`mergeTicks`). */
export type MergedTick = TimelineTick & { readonly extra?: ExtraTick };

const EXTRA_TICK_ID = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** The extra tick id of a read time (RFC 3339): the instant to the second in UTC; null when it is not a time. */
export function extraTickId(readTime: string): string | null {
  const ms = Date.parse(readTime);
  if (!Number.isFinite(ms)) return null;
  const id = `${new Date(ms).toISOString().slice(0, 19)}Z`;
  return EXTRA_TICK_ID.test(id) ? id : null;
}

/** Whether `value` is an extra tick id (`2026-10-05T14:30:00Z`), as opposed to a day tick (`2026-10-05`). */
export function isExtraTickId(value: unknown): boolean {
  return typeof value === 'string' && EXTRA_TICK_ID.test(value) && extraTickId(value) === value;
}

function isExtraSource(source: SnapshotMeta['source']): source is ExtraSource {
  return source === 'export' || source === 'api';
}

/** Where a stored snapshot's read time came from, from its listing metadata (without one: the estimate flag). */
export function readTimeSourceOf(meta: ExtraCandidate['meta']): ExtraReadTimeSource {
  switch (meta.readTimeSource) {
    case 'estimated-max-update-time':
      return 'estimated';
    case 'export-sidecar':
    case 'user':
    case 'api':
      return meta.readTimeSource;
    default:
      if (meta.estimatedReadTime === true) return 'estimated';
      return meta.source === 'api' ? 'api' : 'unknown';
  }
}

/** The snapshot a timeline belongs to: its ref, its scope as Cloud Asset Inventory names it, and its read time. */
export interface TimelineOwner {
  readonly ref: SnapshotRef;
  readonly scopePath: string;
  readonly readTime: string;
}

/** The snapshot whose timeline a slice describes, once its timeline is known with its scope. */
export function ownerOf(timeline: Pick<TimelineSlice, 'ref' | 'info'>): TimelineOwner | null {
  const info: TimelineInfo | null = timeline.info;
  if (info === null || timeline.ref === '') return null;
  if (info.kind === 'live') return { ref: timeline.ref, scopePath: info.scopePath, readTime: info.readTime };
  if (info.scopePath === undefined) return null;
  return { ref: timeline.ref, scopePath: info.scopePath, readTime: info.readTime ?? dayReadTime(info.today) };
}

/** Whether a stored snapshot may be an extra tick of `owner`'s timeline: an export or a pull of its scope, not itself. */
function eligible(candidate: ExtraCandidate, owner: TimelineOwner): boolean {
  return (
    isExtraSource(candidate.meta.source) &&
    candidate.id !== owner.ref &&
    scopePathOf(candidate.meta.scope) === owner.scopePath
  );
}

/** Of the copies of one tick, the one shown: the one stored last (then the greatest id, so the choice is total). */
function newer(a: ExtraCandidate, b: ExtraCandidate): boolean {
  const saved = a.meta.savedAt.localeCompare(b.meta.savedAt);
  return saved > 0 || (saved === 0 && a.id > b.id);
}

/** The extra ticks' snapshots of `owner`'s timeline by tick id: every copy, the shown one first. */
function groups(
  candidates: readonly ExtraCandidate[],
  owner: TimelineOwner,
): ReadonlyMap<string, readonly ExtraCandidate[]> {
  const own = extraTickId(owner.readTime);
  const byId = new Map<string, ExtraCandidate[]>();
  for (const candidate of candidates) {
    if (!eligible(candidate, owner)) continue;
    const id = extraTickId(candidate.meta.readTime);
    // A copy read at the snapshot's own read time is the snapshot itself, which the timeline shows already.
    if (id === null || id === own) continue;
    const copies = byId.get(id) ?? [];
    copies.push(candidate);
    byId.set(id, copies);
  }
  for (const copies of byId.values()) copies.sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0));
  return byId;
}

/**
 * The stored snapshot that extra tick `id` of `owner`'s timeline shows, or null when it has none: what the data
 * worker draws for a view whose `tick` names it (timeline/worker/source.ts), the same copy the bar lists.
 */
export function pickExtra(
  candidates: readonly ExtraCandidate[],
  owner: TimelineOwner,
  id: string,
): ExtraCandidate | null {
  return groups(candidates, owner).get(id)?.[0] ?? null;
}

/** "The export read 2026-11-01 14:30 UTC …": why a tick is not where its read time says. */
function futureWarning(source: ExtraSource, readTime: string): string {
  const what = source === 'api' ? 'The pull' : 'The export';
  return (
    `${what} read ${formatUtc(readTime)} has a read time later than this browser's clock, so the timeline ` +
    'shows it at the present.'
  );
}

/**
 * The extra ticks of `owner`'s timeline among the stored snapshots, in time order (`at`, then id), each at its read
 * time or, when that is later than `now`, at `now` with a warning.
 */
export function extraTicksFor(
  candidates: readonly ExtraCandidate[],
  owner: TimelineOwner,
  now: number,
): readonly ExtraTick[] {
  const ticks: ExtraTick[] = [];
  for (const [id, copies] of groups(candidates, owner)) {
    const shown = copies[0];
    const source = shown?.meta.source;
    if (shown === undefined || source === undefined || !isExtraSource(source)) continue;
    const ref = shown.id;
    if (ref === '' || !isSnapshotRef(ref)) continue;
    const { meta } = shown;
    const read = Date.parse(id);
    const future = read > now;
    ticks.push({
      id,
      ref,
      source,
      readTime: meta.readTime,
      readTimeSource: readTimeSourceOf(meta),
      at: future ? now : read,
      future,
      ...(future ? { warning: futureWarning(source, meta.readTime) } : {}),
      copies: copies.length,
      assetCount: meta.assetCount,
      bytes: meta.bytes,
      ...(meta.detail === undefined ? {} : { detail: meta.detail }),
    });
  }
  return ticks.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/**
 * The timeline's ticks in time order: the day ticks and the extra ticks, each at its `at` (a tie puts the day first,
 * then extra ticks by id), numbered again from 0. An extra tick's `day` and `readTime` are its id. Extra ticks read
 * before the first day are left out.
 */
export function mergeTicks(
  days: readonly TimelineTick[],
  extras: readonly ExtraTick[],
): readonly MergedTick[] {
  // An extra tick read before the timeline's first day is not on the bar:
  // the timeline is the last 35 days, and a stored export is not limited by Cloud Asset Inventory's window.
  const start = days[0]?.at;
  const shown = start === undefined ? extras : extras.filter((extra) => extra.at >= start);
  if (shown.length === 0) return days;
  const all: MergedTick[] = [
    ...days,
    ...shown.map((extra): MergedTick => ({
      index: -1,
      day: extra.id,
      readTime: extra.id,
      at: extra.at,
      extra,
    })),
  ];
  all.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    const extraA = a.extra === undefined ? 0 : 1;
    const extraB = b.extra === undefined ? 0 : 1;
    return extraA - extraB || (extraA === 1 ? a.day.localeCompare(b.day) : a.index - b.index);
  });
  return all.map((tick, index) => (tick.index === index ? tick : { ...tick, index }));
}

/** Whether two lists of extra ticks say the same (the binding writes the slice only when they do not). */
export function sameExtras(a: readonly ExtraTick[] | null, b: readonly ExtraTick[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((tick, index) => JSON.stringify(tick) === JSON.stringify(b[index]));
}

/**
 * The extra ticks of the timeline a slice describes: null while its timeline is not known, none when it names no
 * scope (a history without one).
 */
export function extrasOf(
  timeline: Pick<TimelineSlice, 'ref' | 'info'>,
  candidates: readonly ExtraCandidate[],
  now: number,
): readonly ExtraTick[] | null {
  if (timeline.info === null || timeline.ref === '') return null;
  const owner = ownerOf(timeline);
  return owner === null ? [] : extraTicksFor(candidates, owner, now);
}

/**
 * Keeps the `timeline` slice's extra ticks in step with the stored snapshots `candidates` (the snapshot library's
 * listing): now, and whenever the view's timeline changes (another snapshot, or its timeline becoming known). The
 * library binds again with its next listing. Returns the unsubscribe.
 */
export function bindExtraTicks(
  store: AppStore,
  candidates: readonly ExtraCandidate[],
  clock: () => number = () => Date.now(),
): () => void {
  let seen: Pick<TimelineSlice, 'ref' | 'info'> | null = null;
  const sync = (): void => {
    const { timeline } = store.getState();
    if (seen !== null && seen.ref === timeline.ref && seen.info === timeline.info) return;
    seen = { ref: timeline.ref, info: timeline.info };
    const extras = extrasOf(timeline, candidates, clock());
    if (sameExtras(extras, timeline.extras)) return;
    store.updateTimeline((current) =>
      current.ref === timeline.ref && current.info === timeline.info ? { ...current, extras } : current,
    );
  };
  const unsubscribe = store.subscribe(sync);
  sync();
  return unsubscribe;
}

/** "export" or "pull": what an extra tick is, in its label. */
export const EXTRA_SOURCE_WORDS: Readonly<Record<ExtraSource, string>> = { export: 'export', api: 'pull' };

/**
 * An extra tick's label: "export 2026-10-05 14:30" (its read time in the viewer's local time; to the second when
 * another tick of the timeline is read in the same minute), and " (estimated)" when its read time is the latest
 * asset change. `others` are the timeline's extra ticks.
 */
export function extraTickLabel(
  extra: ExtraTick,
  others: readonly ExtraTick[] = [],
  options: LabelOptions = {},
): string {
  const read = Date.parse(extra.readTime);
  const minute = localMinute(read, options);
  const shared = others.some(
    (other) => other.id !== extra.id && localMinute(Date.parse(other.readTime), options) === minute,
  );
  const when = shared ? localMinute(read, options, true) : minute;
  const estimated = extra.readTimeSource === 'estimated' ? ' (estimated)' : '';
  return `${EXTRA_SOURCE_WORDS[extra.source]} ${when}${estimated}`;
}

/**
 * The label of the day a diff compared with when it is an extra tick of the timeline: "export 2026-10-05 14:30",
 * so the diff wording tells it from the day 5 October; undefined for a day,
 * or an extra tick the timeline does not list (any more).
 */
export function extraDayLabel(
  tick: string | undefined,
  extras: readonly ExtraTick[] | null,
  options: LabelOptions = {},
): string | undefined {
  if (tick === undefined || extras === null || !isExtraTickId(tick)) return undefined;
  const extra = extras.find((candidate) => candidate.id === tick);
  return extra === undefined ? undefined : extraTickLabel(extra, extras, options);
}

/** `day` with its label when it is one of the timeline's extra ticks (the diff wording names it so). */
export function withExtraLabel<T extends { readonly tick?: string; readonly label?: string }>(
  day: T,
  extras: readonly ExtraTick[] | null,
  options: LabelOptions = {},
): T {
  const label = extraDayLabel(day.tick, extras, options);
  return label === undefined || label === day.label ? day : { ...day, label };
}

/** Where an extra tick's read time came from, in words (the slider and the readout say it). */
export const READ_TIME_SOURCE_WORDS: Readonly<Record<ExtraReadTimeSource, string>> = {
  'export-sidecar': "read time from the export's operation.json",
  user: 'read time entered when it was loaded',
  api: 'read time reported by Cloud Asset Inventory',
  estimated: 'read time estimated from the latest asset change',
  unknown: 'read time as stored',
};
