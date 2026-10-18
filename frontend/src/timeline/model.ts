// SPDX-License-Identifier: Apache-2.0
/**
 * What the timeline shows and where it moves, worked out from the view (its `tick`, in the URL hash),
 * the `timeline` slice and the Scene on screen. Pure: the bar, the store's `stepTick`, the `[` and `]` keys and the
 * scene key (`tickToDraw`) all read it.
 *
 * - The view's position is its `tick`, or without one the snapshot's own day (the canonical hash names no tick for
 *   it: `withTick`). A `tick` the timeline does not have (a link older than 35 days) leaves no position and is said.
 * - A tick is available without reading Google Cloud when the snapshot has a history (every day), or it is the
 *   snapshot's own day, or a live day already cached. Only those are drawn: until a live day is read, the diagram
 *   on screen stays (`tickToDraw`), and the bar shows the day as loading.
 * - Marker states: `current` (on screen), `loading` (being read, or the view's day being drawn), `cached`
 *   (available), `error` (its read failed), `unknown` (a live day not read yet).
 * - Extra ticks (extraTicks.ts: the scope's stored exports and manual pulls, in the slice's `extras`) sit among
 *   the days in time order (`allTicksOf`); they are always available (stored here), selectable and stepped through
 *   like days, and played through only with the slice's `playExtras`. Until they are known, a view whose tick names
 *   one is drawn as it asks (the data worker finds the stored snapshot itself) and the bar waits.
 */
import type { ViewSpec, ViewSpecInput } from '@gcportrait/model';

import type { SceneSource } from '../diagram/pipeline/protocol';
import { isExtraTickId, mergeTicks, type ExtraTick, type MergedTick } from './extraTicks';
import type { TimelineSlice } from './state';
import {
  dayOfReadTime,
  historyTicks,
  indexOfDay,
  tickLabel,
  timelineTicks,
  type LabelOptions,
  type TimelineTick,
} from './ticks';
import type { TimelineInfo } from './types';

export type MarkerState = 'unknown' | 'loading' | 'cached' | 'error' | 'current';

/** The snapshot's own day: a history's last day, or the day a live snapshot was read. */
export function ownDayOf(info: TimelineInfo): string | null {
  return info.kind === 'history' ? info.today : dayOfReadTime(info.readTime);
}

const TICKS = new WeakMap<
  TimelineInfo,
  {
    readonly today: string | null;
    readonly now: number | null;
    readonly ticks: readonly TimelineTick[] | null;
  }
>();

/** The timeline's ticks, once the snapshot's timeline is known. */
export function ticksOf(timeline: TimelineSlice): readonly TimelineTick[] | null {
  const { info, today, now } = timeline;
  if (info === null) return null;
  // The scene key asks on every store change (a hover too): the ticks are worked out once per timeline.
  const known = TICKS.get(info);
  if (known !== undefined && known.today === today && known.now === now) return known.ticks;
  const ticks =
    info.kind === 'history'
      ? historyTicks(info.days)
      : today === null
        ? null
        : timelineTicks(today, now ?? undefined);
  TICKS.set(info, { today, now, ticks });
  return ticks;
}

const MERGED = new WeakMap<
  readonly TimelineTick[],
  { readonly extras: TimelineSlice['extras']; readonly ticks: readonly MergedTick[] }
>();

/** The timeline's ticks with its extra ticks among them, in time order, once the timeline is known. */
export function allTicksOf(timeline: TimelineSlice): readonly MergedTick[] | null {
  const days = ticksOf(timeline);
  if (days === null) return null;
  const known = MERGED.get(days);
  if (known !== undefined && known.extras === timeline.extras) return known.ticks;
  const ticks = mergeTicks(days, timeline.extras ?? []);
  MERGED.set(days, { extras: timeline.extras, ticks });
  return ticks;
}

/** The view with its tick at `day`; null (the snapshot's own day) drops the tick, so the hash names none. */
export function withTick(spec: ViewSpec, day: string | null): ViewSpecInput {
  const next: ViewSpecInput = { ...spec };
  if (day === null) delete next.tick;
  else next.tick = day;
  return next;
}

/** Whether the slice describes the view's snapshot and knows its timeline. */
function knows(spec: ViewSpec, timeline: TimelineSlice): timeline is TimelineSlice & { info: TimelineInfo } {
  return spec.snapshot !== '' && timeline.ref === spec.snapshot && timeline.info !== null;
}

/** Whether a live day is cached here (its own day is the snapshot: always). */
function liveAvailable(timeline: TimelineSlice, day: string, own: string | null): boolean {
  return day === own || timeline.status[day] === 'cached';
}

/**
 * The day the pipeline draws for the view (the scene key's `tick`): the view's tick when it can be drawn now, else
 * the one on screen (a live day not read yet keeps the diagram until it is), and nothing for the snapshot's own day
 * or a day the timeline does not have. Before the timeline is known the view's tick is asked for as it is: the data
 * worker draws a history's day at once, and the snapshot itself for a live day it does not have.
 */
export function tickToDraw(
  spec: ViewSpec,
  timeline: TimelineSlice,
  onScreen: Pick<SceneSource, 'ref' | 'tick'> | null,
): string | undefined {
  const { tick } = spec;
  if (tick === undefined) return undefined;
  if (!knows(spec, timeline)) return tick;
  const { info } = timeline;
  const own = ownDayOf(info);
  if (tick === own) return undefined;
  // An extra tick before the extra ticks are known: as it is.
  if (timeline.extras === null && isExtraTickId(tick)) return tick;
  const ticks = allTicksOf(timeline);
  const index = ticks === null ? -1 : indexOfDay(ticks, tick);
  if (ticks === null || index < 0) return undefined;
  // An extra tick is a snapshot stored here: drawn at once.
  if (ticks[index]?.extra !== undefined) return tick;
  if (info.kind === 'history' || liveAvailable(timeline, tick, own)) return tick;
  return onScreen?.ref === spec.snapshot ? onScreen.tick : undefined;
}

export interface TimelineModel {
  /** The days and the extra ticks, in time order. */
  readonly ticks: readonly MergedTick[];
  /** The snapshot's own day, when the timeline has it. */
  readonly own: number | null;
  /** Where the view is: its tick, or the snapshot's own day; null for a tick the timeline does not have. */
  readonly position: number | null;
  /** The view's tick when the timeline does not have it (a link older than its 35 days). */
  readonly outside: string | null;
  /**
   * The extra tick the view names when it is stored here but read before the timeline's first day, so the bar leaves
   * it out; null otherwise.
   */
  readonly outsideExtra: ExtraTick | null;
  /**
   * Where the snapshot's own day lies when the timeline does not have it: `before` its first day, or `after`
   * its last (a snapshot read later than the clock says it is now: a clock that ran ahead, or a future export).
   */
  readonly ownBeyond: 'before' | 'after' | null;
  /** The tick on screen, when the Scene on screen is this snapshot's. */
  readonly drawn: number | null;
  readonly states: readonly MarkerState[];
  /**
   * Per tick, whether playback moves through it: it can be drawn without reading Google Cloud, and, for an extra
   * tick (always drawable), the person asked for extra ticks in playback (`playExtras`).
   */
  readonly available: readonly boolean[];
}

export interface ModelInput {
  readonly spec: ViewSpec;
  readonly timeline: TimelineSlice;
  /** The source of the Scene on screen (the pipeline's result), or null. */
  readonly onScreen: Pick<SceneSource, 'ref' | 'tick'> | null;
  /** The pipeline is preparing a diagram. */
  readonly pending: boolean;
}

/**
 * The bar's model, or null while the snapshot's timeline is not known (nor, when the view names an extra tick, its
 * extra ticks).
 */
export function timelineModel({ spec, timeline, onScreen, pending }: ModelInput): TimelineModel | null {
  if (!knows(spec, timeline)) return null;
  if (timeline.extras === null && isExtraTickId(spec.tick)) return null;
  const ticks = allTicksOf(timeline);
  if (ticks === null) return null;
  const { info } = timeline;
  const ownDay = ownDayOf(info);
  const own = indexOfDay(ticks, ownDay);
  const wanted = spec.tick ?? ownDay;
  const position = indexOfDay(ticks, wanted);
  const shown = onScreen?.ref === spec.snapshot ? (onScreen.tick ?? ownDay) : null;
  const drawn = indexOfDay(ticks, shown);
  const available = ticks.map((tick) =>
    tick.extra !== undefined
      ? timeline.playExtras
      : info.kind === 'history' || liveAvailable(timeline, tick.day, ownDay),
  );
  const states = ticks.map((tick, index): MarkerState => {
    if (index === drawn) return 'current';
    if (tick.extra !== undefined) return index === position && pending ? 'loading' : 'cached';
    const status = info.kind === 'live' && tick.day !== ownDay ? timeline.status[tick.day] : undefined;
    if (status === 'loading' || (index === position && pending && available[index] === true))
      return 'loading';
    if (status === 'error') return 'error';
    return available[index] === true ? 'cached' : 'unknown';
  });
  const outside = spec.tick !== undefined && position < 0 ? spec.tick : null;
  const days = ticks.filter((tick) => tick.extra === undefined);
  const firstDay = days[0]?.day;
  const lastDay = days[days.length - 1]?.day;
  return {
    ticks,
    own: own < 0 ? null : own,
    position: position < 0 ? null : position,
    outside,
    outsideExtra:
      outside === null || !isExtraTickId(outside)
        ? null
        : (timeline.extras?.find((extra) => extra.id === outside) ?? null),
    ownBeyond:
      own >= 0 || ownDay === null || firstDay === undefined || lastDay === undefined
        ? null
        : ownDay > lastDay
          ? 'after'
          : ownDay < firstDay
            ? 'before'
            : null,
    drawn: drawn < 0 ? null : drawn,
    states,
    available,
  };
}

/** Where `[` or `]` (or a step button) moves: the day to write (null: the snapshot's own), or why it cannot. */
export type StepTarget = { readonly day: string | null } | { readonly refusal: string };

/** The target of one step back (-1) or forward (+1) from the view's position. */
export function stepTarget(
  spec: ViewSpec,
  timeline: TimelineSlice,
  step: -1 | 1,
  labels: LabelOptions = {},
): StepTarget {
  if (spec.snapshot === '') return { refusal: 'Open a snapshot to move through its timeline.' };
  if (!knows(spec, timeline) || (timeline.extras === null && isExtraTickId(spec.tick)))
    return { refusal: 'The timeline is not ready yet.' };
  const ticks = allTicksOf(timeline);
  if (ticks === null) return { refusal: 'The timeline is not ready yet.' };
  const ownDay = ownDayOf(timeline.info);
  const at = indexOfDay(ticks, spec.tick ?? ownDay);
  // From a position the timeline does not have, a step enters it at the near end.
  const next = at < 0 ? (step < 0 ? ticks.length - 1 : 0) : at + step;
  const target = ticks[next];
  if (target === undefined) {
    const end = step < 0 ? ticks[0] : ticks[ticks.length - 1];
    const label = end === undefined ? '' : ` (${tickLabel(end, labels)})`;
    return {
      refusal:
        step < 0
          ? `This is the first day of the timeline${label}.`
          : `This is the latest day of the timeline${label}.`,
    };
  }
  return { day: target.day === ownDay ? null : target.day };
}

/** The day of tick `index` to write into the view (null: the snapshot's own day); undefined when out of range. */
export function dayAt(model: Pick<TimelineModel, 'ticks' | 'own'>, index: number): string | null | undefined {
  const tick = model.ticks[index];
  if (tick === undefined) return undefined;
  return index === model.own ? null : tick.day;
}
