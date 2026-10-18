// SPDX-License-Identifier: Apache-2.0
/**
 * Timeline fixtures for the tests (no DOM, no workers): a stored history's and a live scope's timeline, the store's
 * `timeline` slice and the bar's model built from them, a day kept in the tick cache, and a turn of the event loop
 * for fakes that answer at once.
 */
import { decodeViewSpec } from '@gcportrait/model';

import type { StoredTick } from '../../storage/db';
import { TICK_CONTENT_TYPE, tickCacheKey } from '../cacheKey';
import type { ExtraTick } from '../extraTicks';
import { timelineModel, type TimelineModel } from '../model';
import { initialTimeline, type TimelineSlice } from '../state';
import { addDays } from '../ticks';
import type { TimelineInfo } from '../types';

type HistoryInfo = Extract<TimelineInfo, { kind: 'history' }>;
type LiveInfo = Extract<TimelineInfo, { kind: 'live' }>;

/** The demo organisations' last day, the snapshot's own. */
export const HISTORY_TODAY = '2026-10-08';
/** The app's day and "now" for a live scope's timeline. */
export const APP_TODAY = '2026-10-10';
export const APP_NOW = Date.parse('2026-10-10T12:00:00Z');

/** A stored history's timeline: 35 days ending on `today`, oldest first (`extra`: its scope and read time). */
export function historyInfo(today = HISTORY_TODAY, extra: Partial<HistoryInfo> = {}): HistoryInfo {
  return {
    kind: 'history',
    today,
    days: Array.from({ length: 35 }, (_, index) => addDays(today, index - 34)),
    ...extra,
  };
}

/** A live pull of example.com's organisation, read on 7 October at 09:12 UTC. */
export const LIVE_INFO: LiveInfo = {
  kind: 'live',
  scope: { kind: 'organization', id: '30000000001', displayName: 'example.com' },
  scopePath: 'organizations/30000000001',
  readTime: '2026-10-07T09:12:00Z',
};

/**
 * The store's `timeline` slice for snapshot `ref` once the data worker told its timeline (`info`, null: not yet): a
 * history ends on its own last day, a live scope on the app's day at its "now"; `extra` wins.
 */
export function timelineSlice(
  ref: string,
  info: TimelineInfo | null,
  extra: Partial<TimelineSlice> = {},
): TimelineSlice {
  const today = info === null ? null : info.kind === 'history' ? info.today : APP_TODAY;
  return { ...initialTimeline(ref), info, today, now: info?.kind === 'live' ? APP_NOW : null, ...extra };
}

/**
 * The bar's model for the view in `hash` on timeline `info`, with the extra ticks known (none unless given), the
 * diagram of the snapshot's own day on screen unless `tick` names another, and the pipeline idle unless `pending`.
 */
export function modelFor(
  hash: string,
  info: TimelineInfo,
  options: {
    readonly extras?: readonly ExtraTick[];
    readonly tick?: string;
    readonly pending?: boolean;
    readonly extra?: Partial<TimelineSlice>;
  } = {},
): TimelineModel {
  const spec = decodeViewSpec(hash);
  const model = timelineModel({
    spec,
    timeline: timelineSlice(spec.snapshot, info, { extras: options.extras ?? [], ...options.extra }),
    onScreen: { ref: spec.snapshot, ...(options.tick === undefined ? {} : { tick: options.tick }) },
    pending: options.pending ?? false,
  });
  if (model === null) throw new Error(`no timeline model for ${hash}`);
  return model;
}

/** Day `day` of `scope` (`organizations/…`) as the tick cache keeps it, read at that day's 00:00 UTC. */
export function storedTick(scope: string, day: string, extra: Partial<StoredTick> = {}): StoredTick {
  const readTime = `${day}T00:00:00Z`;
  return {
    key: tickCacheKey({ scope, readTime, contentType: TICK_CONTENT_TYPE }),
    scope,
    readTime,
    day,
    contentType: TICK_CONTENT_TYPE,
    now: false,
    actualReadTime: readTime,
    fetchedAt: '2026-10-10T12:00:00.000Z',
    assetCount: 40,
    bytes: 1_000,
    blob: new Blob(['{}']),
    ...extra,
  };
}

/**
 * One turn of the event loop: every promise callback already queued runs first, however many steps it chains, so a
 * fake that answers at once has been heard by the time this resolves.
 */
export function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
