// SPDX-License-Identifier: MIT
/**
 * The timeline controller: runs while the diagram page shows the timeline bar and keeps the store's
 * `timeline` slice in step with the view.
 *
 * - It learns the snapshot's timeline from the first Scene the data worker answers for it (`SceneSource.timeline`):
 *   a stored history (every day local, nothing to read) or a live scope, whose timeline ends on the app's day
 *   (`clock`, the one place the app's "now" enters the timeline) and whose cached days it lists from the tick
 *   cache.
 * - For a live scope it reads days on demand (skill cai-ingestion §5): when the view rests on a day that is
 *   not cached for `debounceMs`, that day; at idle, its two neighbours (the one in the direction of travel first);
 *   at most two reads in flight; a read the view moved away from (no longer the day or a neighbour) is cancelled.
 *   Nothing is read while the view stays where the page opened it on the snapshot's own day.
 *   A day that failed is read again only when the view comes back to it, or on `retry`. A cached day is drawn by
 *   the normal pipeline once its status says so (model.ts `tickToDraw`).
 * - It says why days cannot be read (`blocked`): demo mode, no sign-in, or a permission check for another scope.
 */
import type { SnapshotRef } from '@gcportrait/model';

import type { ImportFailure, ImportProgress } from '../import/progress';
import { pullTargetOf } from '../import/target';
import { scopeName } from '../snapshots/labels';
import type { AppState, AppStore } from '../state';
import type { TickCacheStore } from '../storage/tickCache';
import { TICK_CONTENT_TYPE, tickCacheKey } from './cacheKey';
import { TickReadFailed, type TickFetcher, type TickJob } from './fetchTick';
import { ownDayOf, ticksOf } from './model';
import { createFetchScheduler, fetchOrder, type FetchScheduler } from './scheduler';
import type { TickStatus, TimelineSlice } from './state';
import { dayReadTime, indexOfDay, utcDayOf, type TimelineTick } from './ticks';
import type { TimelineInfo } from './types';

type LiveInfo = Extract<TimelineInfo, { kind: 'live' }>;

/** How long the view rests on a day before it is read (scrubbing past a day reads nothing). */
export const READ_DEBOUNCE_MS = 300;

export interface TimelineControllerOptions {
  readonly store: AppStore;
  readonly cache: TickCacheStore;
  readonly fetchTick: TickFetcher;
  /** Demo mode reads nothing from Google Cloud (ADR 0014). */
  readonly demo: boolean;
  readonly clock?: () => number;
  readonly debounceMs?: number;
  /** Runs `callback` once the page is idle; returns a cancel (default: requestIdleCallback, else a timeout). */
  readonly idle?: (callback: () => void) => () => void;
  /** Runs `callback` after `ms`; returns a cancel. */
  readonly delay?: (callback: () => void, ms: number) => () => void;
}

export interface TimelineController {
  /** Starts following the store. */
  start(): void;
  /** Stops for good: cancels every read and timer (a new controller follows the store again). */
  stop(): void;
  /** Reads `day` again (the bar's "Try again" after a failure). */
  retry(day: string): void;
}

/** A record without `key`. */
function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function defaultDelay(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms);
  return () => {
    clearTimeout(timer);
  };
}

function defaultIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(callback, { timeout: 2000 });
    return () => {
      cancelIdleCallback(handle);
    };
  }
  return defaultDelay(callback, 200);
}

/** What reading a live scope's days needs, or why it cannot be done now. */
export interface LiveAccess {
  readonly target: TickJob['target'] | null;
  readonly blocked: string | null;
}

/** Whether (and as whom) a live scope's days can be read from Google Cloud now. */
export function liveAccess(connect: AppState['connect'], info: LiveInfo, demo: boolean): LiveAccess {
  const name = scopeName(info.scope);
  if (demo)
    return {
      target: null,
      blocked: `This demo instance reads nothing from Google Cloud, so only the days of ${name} kept in this browser can be shown.`,
    };
  const readiness = pullTargetOf(connect);
  if ('blocked' in readiness)
    return {
      target: null,
      blocked: `Reading other days of ${name} needs Google Cloud: ${readiness.blocked} on the Connect page.`,
    };
  const { target } = readiness;
  if (target.scope.kind !== info.scope.kind || target.scope.id !== info.scope.id)
    return {
      target: null,
      blocked: `Reading other days of ${name} needs its permission check: choose it on the Connect page.`,
    };
  return {
    target:
      target.mode === 'user' && target.quotaProject !== undefined
        ? { mode: target.mode, quotaProject: target.quotaProject }
        : { mode: target.mode },
    blocked: null,
  };
}

/** The cache key of a live scope's day (every type, `RESOURCE`). */
export function liveTickKey(info: LiveInfo, day: string): string {
  return tickCacheKey({ scope: info.scopePath, readTime: dayReadTime(day), contentType: TICK_CONTENT_TYPE });
}

export function createTimelineController(options: TimelineControllerOptions): TimelineController {
  const { store, cache, fetchTick, demo } = options;
  const clock = options.clock ?? (() => Date.now());
  const debounceMs = options.debounceMs ?? READ_DEBOUNCE_MS;
  const idle = options.idle ?? defaultIdle;
  const delay = options.delay ?? defaultDelay;

  let ref: SnapshotRef = '';
  /** The view's day last seen, and the direction it moved in. */
  let position: string | null = null;
  let direction: -1 | 0 | 1 = 0;
  /** Whether the live scope's cached days have been listed (no read starts before). */
  let listed = false;
  let target: TickJob['target'] | null = null;
  let cancelDebounce: (() => void) | null = null;
  let cancelIdle: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let syncing = false;
  let again = false;

  const update = (forRef: SnapshotRef, change: (current: TimelineSlice) => TimelineSlice): void => {
    store.updateTimeline((current) => (current.ref === forRef ? change(current) : current));
  };

  const setStatus = (day: string, status: TickStatus | null, failure?: ImportFailure): void => {
    const forRef = ref;
    update(forRef, (current) => {
      const statuses = without(current.status, day);
      const failures = without(current.failures, day);
      const progress = current.progress?.day === day && status !== 'loading' ? null : current.progress;
      return {
        ...current,
        status: status === null ? statuses : { ...statuses, [day]: status },
        failures: failure === undefined ? failures : { ...failures, [day]: failure },
        progress,
      };
    });
  };

  const scheduler: FetchScheduler<TickJob> = createFetchScheduler<TickJob>({
    run: (job, signal) => {
      const forRef = ref;
      return fetchTick(job, signal, (progress: ImportProgress) => {
        if (signal.aborted) return;
        update(forRef, (current) =>
          current.progress === null || current.progress.day === job.day || job.day === position
            ? { ...current, progress: { day: job.day, progress } }
            : current,
        );
      });
    },
    onStart: (job) => {
      setStatus(job.day, 'loading');
    },
    onEnd: (job, outcome, error) => {
      if (outcome === 'done') setStatus(job.day, 'cached');
      else if (outcome === 'cancelled') setStatus(job.day, null);
      else
        setStatus(
          job.day,
          'error',
          error instanceof TickReadFailed
            ? error.failure
            : {
                title: `${job.day} could not be read.`,
                message: error instanceof Error ? error.message : String(error),
              },
        );
    },
  });

  const clearTimers = (): void => {
    cancelDebounce?.();
    cancelDebounce = null;
    cancelIdle?.();
    cancelIdle = null;
  };

  const reset = (next: SnapshotRef): void => {
    clearTimers();
    scheduler.want([]);
    ref = next;
    position = null;
    direction = 0;
    listed = false;
    target = null;
  };

  /** The live timeline's ticks and its own day, when the slice is for a live scope. */
  const liveOf = (
    timeline: TimelineSlice,
  ): { info: LiveInfo; ticks: readonly TimelineTick[]; own: string | null; today: string } | null => {
    const { info, today } = timeline;
    if (info?.kind !== 'live' || today === null) return null;
    const ticks = ticksOf(timeline);
    return ticks === null ? null : { info, ticks, own: ownDayOf(info), today };
  };

  const jobOf = (live: NonNullable<ReturnType<typeof liveOf>>, tick: TimelineTick): TickJob | null =>
    target === null
      ? null
      : {
          key: liveTickKey(live.info, tick.day),
          day: tick.day,
          readTime: tick.readTime,
          scopePath: live.info.scopePath,
          scope: live.info.scope,
          target,
          today: live.today,
        };

  /** The jobs to want for the view's day: the day itself (when `withDay`), then, with `neighbours`, its two. */
  const wanted = (withDay: boolean, neighbours: boolean): TickJob[] => {
    const timeline = store.getState().timeline;
    const live = liveOf(timeline);
    if (live === null || position === null) return [];
    const at = indexOfDay(live.ticks, position);
    if (at < 0) return [];
    const missing = (tick: TimelineTick): boolean =>
      tick.day !== live.own && timeline.status[tick.day] !== 'cached';
    const order = fetchOrder(live.ticks, at, direction, (tick) => {
      if (!missing(tick)) return false;
      if (tick.day === position) return withDay;
      // Prefetch never retries a failed day; it keeps a neighbour that is being read.
      return neighbours
        ? timeline.status[tick.day] !== 'error'
        : scheduler.running().includes(liveTickKey(live.info, tick.day));
    });
    return order.flatMap((tick) => {
      const job = jobOf(live, tick);
      return job === null ? [] : [job];
    });
  };

  /** The view moved to `day`: cancel what it left, read the day once it rests, its neighbours at idle. */
  const moved = (previous: string | null, day: string): void => {
    clearTimers();
    const live = liveOf(store.getState().timeline);
    if (live === null) return;
    const from = indexOfDay(live.ticks, previous);
    const to = indexOfDay(live.ticks, day);
    direction = from < 0 || to < 0 || from === to ? direction : to > from ? 1 : -1;
    const near = new Set(
      [to - 1, to, to + 1].flatMap((index) => {
        const tick = live.ticks[index];
        return tick === undefined ? [] : [liveTickKey(live.info, tick.day)];
      }),
    );
    scheduler.retain((key) => near.has(key));
    if (target === null) return;
    // The page opening on the snapshot's own day reads nothing: the person has not used the timeline yet, and a
    // neighbour is a whole read of the scope.
    if (previous === null && day === live.own) return;
    cancelDebounce = delay(() => {
      cancelDebounce = null;
      scheduler.want(wanted(true, false));
      cancelIdle = idle(() => {
        cancelIdle = null;
        scheduler.want(wanted(true, true));
      });
    }, debounceMs);
  };

  const listCached = (forRef: SnapshotRef, info: LiveInfo, today: string): void => {
    void cache.listScope(info.scopePath).then((records) => {
      if (ref !== forRef) return;
      const cached: Record<string, TickStatus> = {};
      for (const record of records) {
        // A latest day read at "now" counts only while it is still the latest (skill cai-ingestion §5).
        if (record.key !== liveTickKey(info, record.day) || (record.now && record.day !== today)) continue;
        cached[record.day] = 'cached';
      }
      listed = true;
      update(forRef, (current) => ({ ...current, status: { ...cached, ...current.status } }));
      sync();
    });
  };

  /** Adopts the timeline the data worker reported with the snapshot's first Scene. */
  const adopt = (info: TimelineInfo): void => {
    const now = info.kind === 'live' ? clock() : null;
    const today = info.kind === 'history' ? info.today : utcDayOf(now ?? clock());
    const forRef = ref;
    update(forRef, (current) => (current.info === null ? { ...current, info, today, now } : current));
    if (info.kind === 'live') listCached(forRef, info, today);
  };

  const step = (): void => {
    const state = store.getState();
    const next = state.view.onDiagram ? state.view.spec.snapshot : '';
    if (next !== ref) reset(next);
    const { timeline } = state;
    if (ref === '' || timeline.ref !== ref) return;
    if (timeline.info === null) {
      const source = state.pipeline.result?.answer.source;
      if (source?.ref === ref && source.timeline !== undefined) adopt(source.timeline);
      return;
    }
    const live = liveOf(timeline);
    if (live === null) return;
    const access = liveAccess(state.connect, live.info, demo);
    target = access.target;
    if (access.blocked !== timeline.blocked) {
      update(ref, (current) => ({ ...current, blocked: access.blocked }));
      if (target === null) scheduler.want([]);
      // Reading became possible (or impossible): the view's day is taken up again, as if the view had just moved.
      position = null;
      return;
    }
    if (!listed) return;
    const day = state.view.spec.tick ?? live.own;
    if (day !== position) {
      const previous = position;
      position = day;
      moved(previous, day ?? '');
    }
  };

  /** Whether a store change arrived while the last step ran (a step's own updates notify `sync` again). */
  const changedMeanwhile = (): boolean => again;

  /** Follows the store; a store change made while following it is followed after. */
  function sync(): void {
    if (syncing) {
      again = true;
      return;
    }
    syncing = true;
    try {
      do {
        again = false;
        step();
      } while (changedMeanwhile());
    } finally {
      syncing = false;
    }
  }

  return {
    start() {
      if (unsubscribe !== null) return;
      unsubscribe = store.subscribe(sync);
      sync();
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      clearTimers();
      scheduler.dispose();
    },
    retry(day) {
      const live = liveOf(store.getState().timeline);
      const tick = live?.ticks.find((candidate) => candidate.day === day);
      const job = live === null || tick === undefined ? null : jobOf(live, tick);
      if (job === null) return;
      scheduler.want([job, ...wanted(false, true).filter((other) => other.key !== job.key)]);
    },
  };
}
